import { createHash, createHmac } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { buildApp } from '../apps/api/src/app.js';
import { parseApiEnv } from '../apps/api/src/env.js';
import { createServices } from '../apps/api/src/services.js';
import { catalogConnectionHealth } from '../packages/commerce/src/catalog-health.js';
import {
  signMerchantConversionRequest,
  verifyMerchantConversionRequestSignature,
} from '../packages/commerce/src/merchant-conversions.js';
import {
  RedirectTokenError,
  RedirectTokens,
} from '../packages/commerce/src/redirects.js';
import {
  ConnectorHttpError,
  TrendyolConnector,
  WooCommerceConnector,
} from '../packages/connectors/src/index.js';
import { MERCHANT_CONVERSION_HEADERS } from '../packages/contracts/src/merchant-conversions.js';
import {
  connections,
  createDatabase,
  importCatalog,
  memberships,
  merchants,
  products,
  users,
  withTenant,
} from '../packages/db/src/index.js';
import {
  acceptanceFrom,
  failureReport,
  isRehearsalDatabaseName,
  percentile,
  REPORT_SCHEMA_VERSION,
  type RehearsalMetrics,
  rehearsalMcpSearchArguments,
  renderSummary,
  type ScenarioResult,
  seededRandom,
  verdictFrom,
} from './pilot-rehearsal-lib.js';

const DEFAULT_SEED = 23001;
const PRODUCT_COUNT = 10_050;
const JOURNEY_COUNT = 100;
const CONCURRENCY = 5;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactsDirectory = resolve(
  root,
  argument('artifacts-directory') ?? 'artifacts/pilot-rehearsal',
);
const requireFromDb = createRequire(resolve(root, 'packages/db/package.json'));
const { Pool } = requireFromDb('pg') as typeof import('pg');
const DATABASE_MARKER = `shopai-pilot-rehearsal:${REPORT_SCHEMA_VERSION}`;
const processStartedAt = new Date();
let failurePhase = 'arguments';
let failureSeed: number | undefined;
let failureRunMode: string | undefined;

type JourneyCheckout = {
  merchantId: string;
  clickId: string;
  searchId: string;
  offerId: string;
  productId: string;
  variantId: string;
  surface: 'web' | 'chatgpt';
};

function argument(name: string) {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
}

function deterministicUuid(value: string) {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function scenario(
  results: ScenarioResult[],
  id: string,
  operation: () => Promise<Record<string, unknown>> | Record<string, unknown>,
) {
  try {
    const details = await operation();
    results.push({ id, status: 'pass', details });
  } catch (error) {
    results.push({
      id,
      status: 'fail',
      details: {},
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function safeDatabaseUrl() {
  const supplied =
    argument('database-url') ?? process.env.PILOT_REHEARSAL_DATABASE_URL;
  const url = new URL(
    supplied ??
      'postgres://shopai:shopai_local@127.0.0.1:54329/shopai_pilot_rehearsal',
  );
  const databaseName = url.pathname.slice(1);
  if (!isRehearsalDatabaseName(databaseName))
    throw new Error(
      'Refusing to use a non-rehearsal database. The database name must start with shopai_rehearsal or shopai_pilot_rehearsal.',
    );
  return { url, databaseName };
}

async function prepareDatabase(target: URL, databaseName: string) {
  const adminUrl = new URL(target);
  adminUrl.pathname = '/postgres';
  const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
  try {
    const existing = await admin.query(
      'select 1 from pg_database where datname = $1',
      [databaseName],
    );
    if (existing.rowCount) {
      const databaseMarker = await admin.query(
        `select description
         from pg_shdescription
         where objoid = (select oid from pg_database where datname = $1)
           and classoid = 'pg_database'::regclass`,
        [databaseName],
      );
      let marked = databaseMarker.rows[0]?.description === DATABASE_MARKER;
      if (!marked) {
        const marker = new Pool({
          connectionString: target.toString(),
          max: 1,
        });
        try {
          const legacyMarker = await marker.query(
            "select to_regclass('public.shopai_pilot_rehearsal_marker') is not null as marked",
          );
          marked = Boolean(legacyMarker.rows[0]?.marked);
        } finally {
          await marker.end();
        }
      }
      assert(
        marked,
        'Existing database is not marked as a ShopAI rehearsal database.',
      );
      await admin.query(
        'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
        [databaseName],
      );
      await admin.query(`drop database ${databaseName}`);
    }
    await admin.query(`create database ${databaseName}`);
    await admin.query(
      `comment on database ${databaseName} is '${DATABASE_MARKER}'`,
    );
  } finally {
    await admin.end();
  }

  const database = createDatabase(target.toString(), {
    applicationName: 'shopai-pilot-rehearsal-migrate',
  });
  try {
    await migrate(database.db, {
      migrationsFolder: resolve(root, 'packages/db/drizzle'),
    });
    await database.db.execute(sql`
      create table if not exists shopai_pilot_rehearsal_marker (
        schema_version text primary key,
        created_at timestamptz not null default now()
      )
    `);
    await database.db.execute(sql`
      insert into shopai_pilot_rehearsal_marker (schema_version)
      values (${REPORT_SCHEMA_VERSION})
      on conflict (schema_version) do nothing
    `);
  } finally {
    await database.close();
  }
}

async function bootstrapFixtures(databaseUrl: string, seed: number) {
  const database = createDatabase(databaseUrl, {
    applicationName: 'shopai-pilot-rehearsal-bootstrap',
  });
  const merchantIds = Array.from({ length: 5 }, (_, index) =>
    deterministicUuid(`${seed}:merchant:${index}`),
  );
  const connectionIds = Array.from({ length: 6 }, (_, index) =>
    deterministicUuid(`${seed}:connection:${index}`),
  );
  const merchantFixtures = [
    { name: 'Synthetic Woo A', slug: 'synthetic-woo-a', isPublic: true },
    { name: 'Synthetic Woo B', slug: 'synthetic-woo-b', isPublic: true },
    {
      name: 'Synthetic Marketplace C',
      slug: 'synthetic-marketplace-c',
      isPublic: true,
    },
    {
      name: 'Synthetic Marketplace D',
      slug: 'synthetic-marketplace-d',
      isPublic: false,
    },
    {
      name: 'Synthetic Multi Provider E',
      slug: 'synthetic-multi-e',
      isPublic: true,
    },
  ];
  try {
    await database.db.insert(merchants).values(
      merchantFixtures.map((fixture, index) => ({
        id: merchantIds[index] as string,
        ...fixture,
        displayName: fixture.name,
        active: true,
      })),
    );
    const connectionFixtures = [
      [0, 'woocommerce'],
      [1, 'woocommerce'],
      [2, 'trendyol'],
      [3, 'trendyol'],
      [4, 'woocommerce'],
      [4, 'trendyol'],
    ] as const;
    await database.db.insert(connections).values(
      connectionFixtures.map(([merchantIndex, provider], index) => ({
        id: connectionIds[index] as string,
        merchantId: merchantIds[merchantIndex] as string,
        provider,
        active: true,
        authorizationStatus: 'active',
        syncMode: 'incremental',
        lastSuccessfulSyncAt: new Date(),
        lastFetchedAt: new Date(),
        conversionTrackingEnabled: true,
      })),
    );

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    try {
      await pool.query(
        `with generated as (
           select n,
             (substr(md5($1 || ':product:' || n),1,8)||'-'||substr(md5($1 || ':product:' || n),9,4)||'-4'||substr(md5($1 || ':product:' || n),14,3)||'-a'||substr(md5($1 || ':product:' || n),18,3)||'-'||substr(md5($1 || ':product:' || n),21,12))::uuid as product_id
           from generate_series(1, $4::int) n
         )
         insert into products (id, merchant_id, connection_id, external_key, title, description, category, published, image_url, image_alt, observed_at, fetched_at)
         select product_id, $2::uuid, $3::uuid, 'large-'||n,
           'Synthetic Product '||lpad(n::text,5,'0'),
           'Deterministic synthetic rehearsal item '||n,
           case when n % 3 = 0 then 'fishing-rod' else 'tshirt' end,
           true,
           case when n % 17 = 0 then null else 'https://images.synthetic.invalid/products/'||n||'.jpg' end,
           'Synthetic Product '||n, now(), now()
         from generated`,
        [String(seed), merchantIds[0], connectionIds[0], PRODUCT_COUNT],
      );
      await pool.query(
        `with generated as (
           select n,
             (substr(md5($1 || ':product:' || n),1,8)||'-'||substr(md5($1 || ':product:' || n),9,4)||'-4'||substr(md5($1 || ':product:' || n),14,3)||'-a'||substr(md5($1 || ':product:' || n),18,3)||'-'||substr(md5($1 || ':product:' || n),21,12))::uuid as product_id,
             (substr(md5($1 || ':variant:' || n),1,8)||'-'||substr(md5($1 || ':variant:' || n),9,4)||'-4'||substr(md5($1 || ':variant:' || n),14,3)||'-a'||substr(md5($1 || ':variant:' || n),18,3)||'-'||substr(md5($1 || ':variant:' || n),21,12))::uuid as variant_id
           from generate_series(1, $4::int) n
         )
         insert into variants (id, merchant_id, product_id, connection_id, external_id, size, color, observed_at, fetched_at)
         select variant_id, $2::uuid, product_id, $3::uuid, 'large-'||n,
           (array['S','M','L','XL'])[(n % 4)+1],
           (array['black','blue','red','green'])[(n % 4)+1], now(), now()
         from generated`,
        [String(seed), merchantIds[0], connectionIds[0], PRODUCT_COUNT],
      );
      await pool.query(
        `with generated as (
           select n,
             (substr(md5($1 || ':variant:' || n),1,8)||'-'||substr(md5($1 || ':variant:' || n),9,4)||'-4'||substr(md5($1 || ':variant:' || n),14,3)||'-a'||substr(md5($1 || ':variant:' || n),18,3)||'-'||substr(md5($1 || ':variant:' || n),21,12))::uuid as variant_id,
             (substr(md5($1 || ':offer:' || n),1,8)||'-'||substr(md5($1 || ':offer:' || n),9,4)||'-4'||substr(md5($1 || ':offer:' || n),14,3)||'-a'||substr(md5($1 || ':offer:' || n),18,3)||'-'||substr(md5($1 || ':offer:' || n),21,12))::uuid as offer_id
           from generate_series(1, $4::int) n
         )
         insert into offers (id, merchant_id, variant_id, connection_id, external_id, price_minor, currency, checkout_url, active, observed_at, fetched_at)
         select offer_id, $2::uuid, variant_id, $3::uuid, 'large-'||n,
           10000 + ((n * 137) % 90000), 'TRY',
           'https://checkout.synthetic.invalid/woo-a/'||n, true, now(), now()
         from generated`,
        [String(seed), merchantIds[0], connectionIds[0], PRODUCT_COUNT],
      );
      await pool.query(
        `with generated as (
           select n,
             (substr(md5($1 || ':offer:' || n),1,8)||'-'||substr(md5($1 || ':offer:' || n),9,4)||'-4'||substr(md5($1 || ':offer:' || n),14,3)||'-a'||substr(md5($1 || ':offer:' || n),18,3)||'-'||substr(md5($1 || ':offer:' || n),21,12))::uuid as offer_id
           from generate_series(1, $3::int) n
         )
         insert into inventory (offer_id, merchant_id, available, observed_at, fetched_at)
         select offer_id, $2::uuid, case when n % 11 = 0 then false when n % 29 = 0 then null else true end, now(), now()
         from generated`,
        [String(seed), merchantIds[0], PRODUCT_COUNT],
      );
    } finally {
      await pool.end();
    }

    for (
      let merchantIndex = 1;
      merchantIndex < merchantIds.length;
      merchantIndex += 1
    ) {
      const connectionIndex = merchantIndex === 4 ? 4 : merchantIndex;
      const rows = Array.from({ length: 8 }, (_, rowIndex) => ({
        externalId: `m${merchantIndex}-offer-${rowIndex}`,
        productKey: `m${merchantIndex}-product-${rowIndex}`,
        title: `Synthetic Merchant ${merchantIndex + 1} Product ${rowIndex + 1}`,
        description: 'Small deterministic synthetic catalog item',
        category: rowIndex % 2 ? 'tshirt' : 'fishing-rod',
        imageUrl: `https://images.synthetic.invalid/m${merchantIndex}/${rowIndex}.jpg`,
        imageAlt: `Synthetic item ${rowIndex + 1}`,
        size: ['S', 'M', 'L', 'XL'][rowIndex % 4] as string,
        color: ['black', 'blue', 'red', 'green'][rowIndex % 4] as string,
        priceMinor: 15_000 + merchantIndex * 1_000 + rowIndex * 250,
        currency: 'TRY' as const,
        available: rowIndex % 5 !== 0,
        checkoutUrl: `https://checkout.synthetic.invalid/m${merchantIndex}/${rowIndex}`,
      }));
      await importCatalog(database.db, {
        schemaVersion: 1,
        runId: deterministicUuid(`${seed}:import:${merchantIndex}`),
        merchantId: merchantIds[merchantIndex] as string,
        connectionId: connectionIds[connectionIndex] as string,
        observedAt: new Date('2026-09-15T08:00:00.000Z').toISOString(),
        rows,
      });
      await database.db
        .update(products)
        .set({ published: true })
        .where(eq(products.merchantId, merchantIds[merchantIndex] as string));
    }
    // The rehearsal immediately queries a freshly bulk-loaded 10k+ catalog.
    // Do not race PostgreSQL auto-analyze: stale/default planner estimates made
    // identical seeded runs vary from seconds to tens of minutes in CI.
    await database.db.execute(
      sql`analyze merchants, products, variants, offers, inventory`,
    );
    return { database, merchantIds, connectionIds };
  } catch (error) {
    await database.close();
    throw error;
  }
}

function wooProduct(id: number) {
  return {
    id,
    name: `Upstream Synthetic Product ${id}`,
    type: 'simple',
    price: String(100 + (id % 100)),
    permalink: `https://checkout.synthetic.invalid/upstream/${id}`,
    stock_status: id % 11 === 0 ? 'outofstock' : 'instock',
    date_modified_gmt: '2026-09-15T08:00:00',
    description: `<p>Synthetic ${id}</p>`,
    categories: [{ slug: id % 2 ? 'tshirt' : 'fishing-rod' }],
    images: [
      {
        src: `https://images.synthetic.invalid/upstream/${id}.jpg`,
        alt: `Synthetic ${id}`,
      },
    ],
    attributes: [
      { name: 'Size', options: ['M'] },
      { name: 'Color', options: ['Black'] },
    ],
  };
}

async function connectorScenarios(results: ScenarioResult[]) {
  const credentials = {
    storeUrl: 'https://synthetic-upstream.invalid',
    consumerKey: 'synthetic-key',
    consumerSecret: 'synthetic-secret',
  };
  await scenario(results, 'upstream-429', async () => {
    let calls = 0;
    const waits: number[] = [];
    const connector = new WooCommerceConnector(
      credentials,
      async () => {
        calls += 1;
        return calls === 1
          ? new Response('rate limited', {
              status: 429,
              headers: { 'retry-after': '1' },
            })
          : Response.json([wooProduct(1)], {
              headers: { 'x-wp-totalpages': '1' },
            });
      },
      async (milliseconds) => {
        waits.push(milliseconds);
      },
    );
    const page = await connector.readPage({ mode: 'full' });
    assert(
      page.rows.length === 1 && waits[0] === 1000,
      '429 Retry-After was not honored.',
    );
    return { calls, retryAfterMs: waits[0] };
  });
  await scenario(results, 'upstream-5xx', async () => {
    let calls = 0;
    const connector = new WooCommerceConnector(
      credentials,
      async () => {
        calls += 1;
        return calls === 1
          ? new Response('temporary', { status: 503 })
          : Response.json([wooProduct(2)], {
              headers: { 'x-wp-totalpages': '1' },
            });
      },
      async () => {},
    );
    await connector.readPage({ mode: 'full' });
    assert(calls === 2, 'Transient 5xx was not retried exactly once.');
    return { calls };
  });
  await scenario(results, 'retry-exhaustion', async () => {
    let calls = 0;
    const connector = new WooCommerceConnector(
      credentials,
      async () => {
        calls += 1;
        return new Response('down', { status: 503 });
      },
      async () => {},
      3,
    );
    let exhausted = false;
    try {
      await connector.readPage({ mode: 'full' });
    } catch (error) {
      exhausted = error instanceof ConnectorHttpError && error.status === 503;
    }
    assert(
      exhausted && calls === 3,
      'Retry exhaustion did not fail after three attempts.',
    );
    return { calls, expectedFailure: true };
  });
  await scenario(results, 'connector-pagination-10k', async () => {
    const totalPages = Math.ceil(PRODUCT_COUNT / 100);
    const connector = new TrendyolConnector(
      {
        sellerId: '23001',
        apiKey: 'synthetic-api-key',
        apiSecret: 'synthetic-api-secret',
        environment: 'stage',
      },
      async (input) => {
        const requestUrl = new URL(String(input));
        const token = requestUrl.searchParams.get('nextPageToken');
        const page = token
          ? 100
          : Number(requestUrl.searchParams.get('page') ?? '0');
        const first = page * 100 + 1;
        const count = Math.min(100, PRODUCT_COUNT - first + 1);
        const variants = Array.from(
          { length: Math.max(0, count) },
          (_, index) => {
            const id = first + index;
            return {
              variantId: id,
              productUrl: `https://stage.trendyol.com/synthetic-p-${id}`,
              onSale: true,
              stock: { quantity: id % 11 === 0 ? 0 : 3 },
              price: { salePrice: 100 + (id % 100) },
              sellerModifiedDate: Date.parse('2026-09-15T08:00:00.000Z'),
              attributes: [
                { attributeName: 'Beden', attributeValue: 'M' },
                { attributeName: 'Renk', attributeValue: 'Siyah' },
              ],
            };
          },
        );
        return Response.json({
          page,
          totalPages,
          nextPageToken: page >= 99 ? 'after-10000' : null,
          content: count
            ? [
                {
                  contentId: first,
                  productMainId: `main-${page}`,
                  title: `Synthetic Trendyol Page ${page}`,
                  description: 'Synthetic upstream page',
                  category: { name: 'Tişört' },
                  images: [
                    { url: `https://stage.trendyol.com/image/${page}.jpg` },
                  ],
                  variants,
                },
              ]
            : [],
        });
      },
      async () => {},
      3,
      () => Date.parse('2026-09-15T08:00:00.000Z'),
      0,
    );
    let cursor: string | null | undefined;
    let rows = 0;
    let pages = 0;
    do {
      const page = await connector.readPage({ mode: 'full', cursor });
      rows += page.rows.length;
      pages += 1;
      cursor = page.nextCursor;
    } while (cursor);
    assert(
      rows === PRODUCT_COUNT && pages > 100,
      'Connector did not traverse the 10k+ cursor boundary.',
    );
    return { rows, pages, finalNextPageToken: cursor ?? null };
  });
}

async function runPool(
  count: number,
  concurrency: number,
  task: (index: number) => Promise<void>,
) {
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const index = next;
        next += 1;
        if (index >= count) return;
        await task(index);
      }
    }),
  );
}

async function main() {
  const startedAt = new Date();
  const seed = Number(argument('seed') ?? DEFAULT_SEED);
  failureSeed = seed;
  assert(Number.isSafeInteger(seed), 'Seed must be a safe integer.');
  const mode = argument('mode') ?? (process.env.CI ? 'ci' : 'local');
  failureRunMode = mode;
  const { url, databaseName } = safeDatabaseUrl();
  failurePhase = 'database-preparation';
  await prepareDatabase(url, databaseName);
  failurePhase = 'fixture-bootstrap';
  const { database, merchantIds, connectionIds } = await bootstrapFixtures(
    url.toString(),
    seed,
  );
  const redirectSecret = `synthetic-redirect-${createHash('sha256').update(String(seed)).digest('hex')}`;
  const conversionSecret = `synthetic-conversion-${createHash('sha256').update(`conversion:${seed}`).digest('hex')}`;
  const ownerEmail = `pilot-rehearsal-${seed}@synthetic.invalid`;
  const ownerToken = `synthetic-owner-token-${seed}-0000000000000000`;
  const env = parseApiEnv({
    CATALOG_MODE: 'postgres',
    DATABASE_URL: url.toString(),
    DEPLOY_ENV: 'local',
    RELEASE_VERSION: 'synthetic-rehearsal',
    LOG_LEVEL: 'silent',
    MCP_PUBLIC_ORIGIN: 'https://api.synthetic.invalid',
    WIDGET_ORIGIN: 'https://widget.synthetic.invalid',
    MCP_ALLOWED_ORIGINS: 'https://chatgpt.com,https://web.synthetic.invalid',
    REDIRECT_SIGNING_SECRET: redirectSecret,
    REDIRECT_TOKEN_TTL_SECONDS: 900,
    CONVERSION_CALLBACK_SECRET: conversionSecret,
    AUTH_PILOT_CREDENTIALS: JSON.stringify({ [ownerEmail]: ownerToken }),
    UPLOAD_DIR: '/tmp/shopai-pilot-rehearsal-uploads',
  });
  const services = createServices(env);
  const app = await buildApp(services, env);
  failurePhase = 'rehearsal-scenarios';
  const login = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { email: ownerEmail, token: ownerToken },
  });
  assert(login.statusCode === 200, 'Synthetic owner login failed.');
  const ownerCookie = login.headers['set-cookie']?.split(';')[0] ?? '';
  assert(ownerCookie, 'Synthetic owner session cookie was not issued.');
  const [owner] = await database.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, ownerEmail));
  assert(owner, 'Synthetic owner was not persisted.');
  await database.db.insert(memberships).values({
    userId: owner.id,
    merchantId: merchantIds[0] as string,
    role: 'owner',
  });
  const scenarios: ScenarioResult[] = [];
  const latencies: number[] = [];
  const checkouts: JourneyCheckout[] = [];
  let requestCount = 0;
  let successCount = 0;
  let errorCount = 0;
  let webJourneys = 0;
  let chatgptJourneys = 0;
  let realMcpTransportTests = 0;

  const measured = async <T,>(operation: () => Promise<T>) => {
    const began = performance.now();
    requestCount += 1;
    try {
      const value = await operation();
      successCount += 1;
      return value;
    } catch (error) {
      errorCount += 1;
      throw error;
    } finally {
      latencies.push(performance.now() - began);
    }
  };

  try {
    await connectorScenarios(scenarios);
    await scenario(scenarios, 'synthetic-merchant-mix', async () => {
      const result = await database.db.execute(sql`
        select
          count(distinct m.id)::int as merchants,
          count(*) filter (where c.provider = 'woocommerce')::int as woocommerce,
          count(*) filter (where c.provider = 'trendyol')::int as trendyol,
          count(distinct c.merchant_id) filter (where c.merchant_id in (
            select merchant_id from source_connections group by merchant_id having count(*) > 1
          ))::int as "multiProviderMerchants",
          count(distinct m.id) filter (where m.is_public = false)::int as "privateMerchants"
        from merchants m join source_connections c on c.merchant_id = m.id
      `);
      const row = result.rows[0] as Record<string, number>;
      assert(
        row.merchants === 5 &&
          row.woocommerce >= 3 &&
          row.trendyol >= 3 &&
          row.multiProviderMerchants >= 1 &&
          row.privateMerchants >= 1,
        'Synthetic merchant/provider mix is incomplete.',
      );
      return row;
    });
    await scenario(scenarios, 'deterministic-seed', () => {
      const first = Array.from({ length: 8 }, seededRandom(seed));
      const second = Array.from({ length: 8 }, seededRandom(seed));
      assert(
        JSON.stringify(first) === JSON.stringify(second),
        'Seeded generator diverged.',
      );
      return { seed, sample: first.slice(0, 3) };
    });

    await runPool(JOURNEY_COUNT, CONCURRENCY, async (index) => {
      const surface = index % 2 === 0 ? ('web' as const) : ('chatgpt' as const);
      const transport =
        surface === 'web' ? ('rest' as const) : ('mcp' as const);
      if (surface === 'web') webJourneys += 1;
      else chatgptJourneys += 1;
      // Five journeys exercise the 10k+ merchant. The remaining bounded load
      // uses smaller isolated catalogs so CI still traverses every real path
      // without turning facet aggregation into an uncontrolled stress test.
      const merchantIndex = index < 5 ? 0 : ([1, 2, 4][index % 3] as number);
      const merchantId = merchantIds[merchantIndex] as string;
      const anonymousUserId = deterministicUuid(`${seed}:shopper:${index}`);
      const session = await measured(() =>
        services.discoverySessions.create(
          { surface, merchant: merchantId, campaign: `synthetic-${index % 4}` },
          { transport, anonymousUserId },
        ),
      );
      const attribution = { surface, transport };
      await measured(() =>
        services.executePublicSearch(
          {
            discoverySessionId: session.id,
            query: '',
            analyticsIntent: 'catalog_load',
            limit: 3,
          },
          { merchantIds: [merchantId] },
          attribution,
        ),
      );
      const explicit = await measured(() =>
        services.executePublicSearch(
          {
            discoverySessionId: session.id,
            query: 'Synthetic',
            analyticsIntent: 'explicit_search',
            limit: 3,
          },
          { merchantIds: [merchantId] },
          attribution,
        ),
      );
      assert(
        explicit.products.length > 0,
        `Journey ${index} explicit search was empty.`,
      );
      await measured(() =>
        services.executePublicSearch(
          {
            discoverySessionId: session.id,
            query: index % 3 === 0 ? 'Synthetic Product' : 'Synthetic',
            category: index % 2 === 0 ? 'tshirt' : 'fishing-rod',
            analyticsIntent: 'refinement',
            limit: 3,
          },
          { merchantIds: [merchantId] },
          attribution,
        ),
      );
      assert(
        explicit.nextCursor,
        `Journey ${index} did not produce a pagination cursor.`,
      );
      await measured(() =>
        services.executePublicSearch(
          {
            discoverySessionId: session.id,
            query: 'Synthetic',
            cursor: explicit.nextCursor,
            analyticsIntent: 'catalog_load',
            limit: 3,
          },
          { merchantIds: [merchantId] },
          attribution,
        ),
      );
      const selected =
        explicit.products[index % explicit.products.length] ??
        explicit.products[0];
      assert(selected, `Journey ${index} did not select a product.`);
      const detail = await measured(() =>
        services.executeProductDetail(
          {
            productId: selected.productId,
            searchId: explicit.searchId,
            discoverySessionId: session.id,
          },
          { merchantIds: [merchantId] },
          attribution,
        ),
      );
      assert(
        detail.product.id === selected.productId,
        'Product detail identity changed.',
      );
      if (index % 4 === 0) {
        const link = services.redirects.createLink({
          offerId: selected.offerId,
          searchId: explicit.searchId,
          ...attribution,
        });
        const token = new URL(link).pathname.split('/').at(-1);
        assert(token, 'Redirect token was missing.');
        const opened = await measured(() =>
          services.redirects.open(token, {
            userAgent: 'ShopAI-Synthetic-Rehearsal/1.0',
          }),
        );
        assert(
          opened?.classification === 'human',
          'Synthetic checkout was not classified as human.',
        );
        assert(
          new URL(opened.url).hostname === 'checkout.synthetic.invalid',
          'Checkout escaped the synthetic target.',
        );
        checkouts.push({
          merchantId,
          clickId: opened.clickId,
          searchId: explicit.searchId,
          offerId: selected.offerId,
          productId: selected.productId,
          variantId: selected.variantId,
          surface,
        });
      }
    });
    await scenario(scenarios, 'product-detail', () => ({
      productViews: JOURNEY_COUNT,
    }));
    checkouts.sort((left, right) =>
      left.productId.localeCompare(right.productId),
    );
    await scenario(scenarios, 'save-unsave', async () => {
      const selected = checkouts[0] as JourneyCheckout;
      const saved = await measured(() =>
        app.inject({
          method: 'POST',
          url: '/v1/saved-products',
          headers: { cookie: ownerCookie },
          payload: {
            productId: selected.productId,
            variantId: selected.variantId,
          },
        }),
      );
      assert(saved.statusCode === 201, `Save returned ${saved.statusCode}.`);
      const savedId = saved.json().item?.id as string | undefined;
      assert(savedId, 'Saved product id was missing.');
      const removed = await measured(() =>
        app.inject({
          method: 'DELETE',
          url: `/v1/saved-products/${savedId}`,
          headers: { cookie: ownerCookie },
        }),
      );
      assert(
        removed.statusCode === 200 && removed.json().removed === true,
        'Unsave did not remove the product.',
      );
      return { saved: true, unsaved: true };
    });

    await scenario(scenarios, 'real-mcp-transport', async () => {
      const response = await measured(() =>
        app.inject({
          method: 'POST',
          url: '/mcp',
          headers: { accept: 'application/json, text/event-stream' },
          payload: {
            jsonrpc: '2.0',
            id: 'pilot-rehearsal-mcp',
            method: 'tools/call',
            params: {
              name: 'search_products',
              arguments: rehearsalMcpSearchArguments(merchantIds[1] as string),
            },
          },
        }),
      );
      const responseBody = response.json();
      const products = responseBody.result?.structuredContent?.products;
      const observedProductCount = Array.isArray(products)
        ? products.length
        : 'missing';
      assert(
        response.statusCode === 200 &&
          Array.isArray(products) &&
          products.length,
        `Real MCP tools/call invariant failed: observed status=${response.statusCode}, products=${observedProductCount}; expected status=200, products>=1.`,
      );
      realMcpTransportTests += 1;
      return {
        endpoint: '/mcp',
        method: 'tools/call',
        tool: 'search_products',
        resultCount: products.length,
      };
    });

    await scenario(scenarios, 'search-outcomes', async () => {
      const merchantId = merchantIds[1] as string;
      const attribution = {
        transport: 'rest' as const,
        surface: 'web' as const,
      };
      const emptySession = await services.discoverySessions.create(
        { surface: 'web', merchant: merchantId },
        {
          transport: 'rest',
          anonymousUserId: deterministicUuid(`${seed}:empty-search`),
        },
      );
      const empty = await measured(() =>
        services.executePublicSearch(
          {
            discoverySessionId: emptySession.id,
            query: '__no_synthetic_product_can_match_this__',
            analyticsIntent: 'explicit_search',
          },
          { merchantIds: [merchantId] },
          attribution,
        ),
      );
      assert(
        empty.products.length === 0,
        'No-result fixture returned products.',
      );

      const errorSession = await services.discoverySessions.create(
        { surface: 'web', merchant: merchantId },
        {
          transport: 'rest',
          anonymousUserId: deterministicUuid(`${seed}:error-search`),
        },
      );
      let rejected = false;
      try {
        await measured(() =>
          services.executeSearch(
            {
              discoverySessionId: errorSession.id,
              query: 'Synthetic',
              filters: { minPriceMinor: 20_000, maxPriceMinor: 10_000 },
              analyticsIntent: 'explicit_search',
            },
            { merchantIds: [merchantId] },
            attribution,
          ),
        );
      } catch {
        rejected = true;
      }
      assert(rejected, 'Search error fixture unexpectedly succeeded.');
      return { emptySearches: 1, failedSearches: 1 };
    });

    const eventCounts = await database.db.execute(sql`
      select
        count(*) filter (where intent = 'catalog_load')::int as "catalogLoads",
        count(*) filter (where intent = 'explicit_search')::int as "explicitSearches",
        count(*) filter (where intent = 'refinement')::int as refinements,
        count(*) filter (where intent = 'pagination')::int as "paginationRequests",
        count(*) filter (where intent in ('explicit_search','refinement'))::int as "searchAttempts",
        count(*) filter (where intent in ('explicit_search','refinement') and outcome <> 'error')::int as "successfulSearches",
        count(*) filter (where intent in ('explicit_search','refinement') and outcome = 'empty')::int as "emptySearches",
        count(*) filter (where intent in ('explicit_search','refinement') and outcome = 'error')::int as "failedSearches"
      from search_events
    `);
    const taxonomy = eventCounts.rows[0] as Record<string, number>;
    await scenario(scenarios, 'search-taxonomy', () => {
      assert(
        taxonomy.catalogLoads === JOURNEY_COUNT,
        `catalog_load count mismatch: observed=${taxonomy.catalogLoads}, expected=${JOURNEY_COUNT}.`,
      );
      assert(
        taxonomy.explicitSearches === JOURNEY_COUNT + 3,
        `explicit_search count mismatch: observed=${taxonomy.explicitSearches}, expected=${JOURNEY_COUNT + 3}.`,
      );
      assert(
        taxonomy.refinements === JOURNEY_COUNT,
        `refinement count mismatch: observed=${taxonomy.refinements}, expected=${JOURNEY_COUNT}.`,
      );
      assert(
        taxonomy.paginationRequests === JOURNEY_COUNT,
        `pagination count mismatch: observed=${taxonomy.paginationRequests}, expected=${JOURNEY_COUNT}.`,
      );
      assert(
        taxonomy.searchAttempts ===
          taxonomy.explicitSearches + taxonomy.refinements,
        'catalog_load or pagination leaked into searchAttempts.',
      );
      assert(
        taxonomy.emptySearches === 1 && taxonomy.failedSearches === 1,
        `Controlled search outcomes mismatch: observed empty=${taxonomy.emptySearches}, error=${taxonomy.failedSearches}; expected empty=1, error=1.`,
      );
      return taxonomy;
    });

    await scenario(scenarios, 'expired-redirect', () => {
      const tokens = new RedirectTokens(redirectSecret, 60);
      const token = tokens.create(
        {
          offerId: checkouts[0]?.offerId as string,
          searchId: checkouts[0]?.searchId as string,
          transport: 'rest',
          surface: 'web',
        },
        1_000_000,
      );
      let code = '';
      try {
        tokens.verify(token, 1_061_000);
      } catch (error) {
        if (error instanceof RedirectTokenError) code = error.code;
      }
      assert(code === 'EXPIRED_TOKEN', 'Expired redirect token was accepted.');
      return { rejection: code };
    });
    await scenario(scenarios, 'tampered-redirect', () => {
      const tokens = new RedirectTokens(redirectSecret, 60);
      const token = tokens.create({
        offerId: checkouts[0]?.offerId as string,
        searchId: checkouts[0]?.searchId as string,
        transport: 'rest',
        surface: 'web',
      });
      const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
      let code = '';
      try {
        tokens.verify(tampered);
      } catch (error) {
        if (error instanceof RedirectTokenError) code = error.code;
      }
      assert(code === 'INVALID_TOKEN', 'Tampered redirect token was accepted.');
      return { rejection: code };
    });

    let conversionCallbacks = 0;
    for (const [index, checkout] of checkouts.slice(0, 12).entries()) {
      const payload = {
        clickId: checkout.clickId,
        orderId: `synthetic-paid-${seed}-${index}`,
        orderValue: 100 + index,
        currency: 'TRY' as const,
      };
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = signMerchantConversionRequest({
        rootSecret: conversionSecret,
        merchantId: checkout.merchantId,
        timestamp,
        payload,
      });
      assert(
        verifyMerchantConversionRequestSignature({
          rootSecret: conversionSecret,
          merchantId: checkout.merchantId,
          timestamp,
          signature,
          payload,
        }).valid,
        'Valid conversion signature failed verification.',
      );
      const response = await measured(() =>
        app.inject({
          method: 'POST',
          url: '/merchant/conversions',
          headers: {
            [MERCHANT_CONVERSION_HEADERS.merchantId]: checkout.merchantId,
            [MERCHANT_CONVERSION_HEADERS.timestamp]: timestamp,
            [MERCHANT_CONVERSION_HEADERS.signature]: signature,
          },
          payload,
        }),
      );
      assert(
        response.statusCode === 201 && response.json().accepted === true,
        `Signed paid conversion callback returned ${response.statusCode}.`,
      );
      conversionCallbacks += 1;
    }
    await scenario(scenarios, 'conversion-signatures', async () => {
      const checkout = checkouts[0] as JourneyCheckout;
      const payload = {
        clickId: checkout.clickId,
        orderId: 'invalid',
        orderValue: 10,
        currency: 'TRY' as const,
      };
      const invalid = verifyMerchantConversionRequestSignature({
        rootSecret: conversionSecret,
        merchantId: checkout.merchantId,
        timestamp: String(Math.floor(Date.now() / 1000)),
        signature: '0'.repeat(64),
        payload,
      });
      assert(
        !invalid.valid && invalid.code === 'INVALID_SIGNATURE',
        'Invalid conversion signature was accepted.',
      );
      const rejected = await app.inject({
        method: 'POST',
        url: '/merchant/conversions',
        headers: {
          [MERCHANT_CONVERSION_HEADERS.merchantId]: checkout.merchantId,
          [MERCHANT_CONVERSION_HEADERS.timestamp]: String(
            Math.floor(Date.now() / 1000),
          ),
          [MERCHANT_CONVERSION_HEADERS.signature]: '0'.repeat(64),
        },
        payload,
      });
      assert(
        rejected.statusCode === 401 &&
          rejected.json().code === 'INVALID_SIGNATURE',
        'Conversion callback route did not reject an invalid signature.',
      );
      return {
        validAccepted: true,
        invalidRejected: true,
        invalidHttpStatus: rejected.statusCode,
      };
    });
    await scenario(scenarios, 'checkout-attribution', async () => {
      const result = await database.db.execute(sql`
        select count(*)::int as count from conversion_orders
        where click_id is not null and search_id is not null and offer_id is not null
      `);
      assert(
        Number(result.rows[0]?.count) === 12,
        'Conversion attribution was not preserved.',
      );
      return { checkouts: checkouts.length, attributedPaidOrders: 12 };
    });

    const legacyEvent = async (
      checkout: JourneyCheckout,
      body: Record<string, unknown>,
    ) => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const raw = JSON.stringify(body);
      const merchantSecret = createHmac('sha256', conversionSecret)
        .update(checkout.merchantId)
        .digest();
      const signature = createHmac('sha256', merchantSecret)
        .update(`${timestamp}.${raw}`)
        .digest('hex');
      const response = await measured(() =>
        app.inject({
          method: 'POST',
          url: `/v1/conversions/${checkout.merchantId}/${connectionIds[checkout.merchantId === merchantIds[0] ? 0 : checkout.merchantId === merchantIds[1] ? 1 : checkout.merchantId === merchantIds[2] ? 2 : 4]}`,
          headers: {
            'x-shopai-timestamp': timestamp,
            'x-shopai-signature': signature,
          },
          payload: body,
        }),
      );
      assert(
        response.statusCode === 202,
        `Legacy conversion returned ${response.statusCode}.`,
      );
      conversionCallbacks += 1;
    };
    const largeMerchantCheckouts = checkouts.filter(
      (checkout) => checkout.merchantId === merchantIds[0],
    );
    const refunded = largeMerchantCheckouts[0] as JourneyCheckout;
    const cancelled = largeMerchantCheckouts[1] as JourneyCheckout;
    const unattributed = checkouts.find(
      (checkout) => checkout.merchantId !== merchantIds[0],
    ) as JourneyCheckout;
    assert(
      refunded && cancelled && unattributed,
      'Representative conversion outcomes lack checkout fixtures.',
    );
    await legacyEvent(refunded, {
      orderId: `synthetic-refunded-${seed}`,
      status: 'refunded',
      grossMinor: 20_000,
      refundedMinor: 5_000,
      currency: 'TRY',
      searchId: refunded.searchId,
      offerId: refunded.offerId,
      occurredAt: new Date().toISOString(),
    });
    await legacyEvent(cancelled, {
      orderId: `synthetic-cancelled-${seed}`,
      status: 'cancelled',
      grossMinor: 30_000,
      refundedMinor: 0,
      currency: 'TRY',
      searchId: cancelled.searchId,
      offerId: cancelled.offerId,
      occurredAt: new Date().toISOString(),
    });
    await legacyEvent(unattributed, {
      orderId: `synthetic-unattributed-${seed}`,
      status: 'paid',
      grossMinor: 40_000,
      refundedMinor: 0,
      currency: 'TRY',
      searchId: null,
      offerId: null,
      occurredAt: new Date().toISOString(),
    });
    await scenario(scenarios, 'refund-cancel', async () => {
      const result = await database.db.execute(sql`
        select
          count(*) filter (where search_id is not null and offer_id is not null and status <> 'cancelled')::int as orders,
          coalesce(sum(gross_minor) filter (where search_id is not null and offer_id is not null and status <> 'cancelled'),0)::bigint as gross,
          coalesce(sum(gross_minor-refunded_minor) filter (where search_id is not null and offer_id is not null and status <> 'cancelled'),0)::bigint as net
        from conversion_orders
      `);
      const row = result.rows[0] as {
        orders: number;
        gross: string;
        net: string;
      };
      assert(
        Number(row.orders) === 13,
        'Cancelled or unattributed order leaked into attributed order count.',
      );
      assert(
        Number(row.gross) - Number(row.net) === 5_000,
        'Refund was not reflected in net revenue.',
      );
      return {
        attributedOrders: Number(row.orders),
        attributedGmvMinor: Number(row.gross),
        netRevenueMinor: Number(row.net),
      };
    });
    await scenario(scenarios, 'merchant-analytics', async () => {
      const analyticsFrom = new Date(startedAt.getTime() - 60_000);
      const analyticsTo = new Date(Date.now() + 60_000);
      const expectedResult = await database.db.execute(sql`
        select
          count(*) filter (where search_id is not null and offer_id is not null and status <> 'cancelled')::int as orders,
          coalesce(sum(gross_minor) filter (where search_id is not null and offer_id is not null and status <> 'cancelled'),0)::bigint as gross,
          coalesce(sum(gross_minor-refunded_minor) filter (where search_id is not null and offer_id is not null and status <> 'cancelled'),0)::bigint as net
        from conversion_orders
        where merchant_id = ${merchantIds[0]}
          and occurred_at >= ${analyticsFrom}
          and occurred_at < ${analyticsTo}
      `);
      const expected = expectedResult.rows[0] as {
        orders: number;
        gross: string;
        net: string;
      };
      const response = await measured(() =>
        app.inject({
          method: 'GET',
          url:
            `/v1/merchants/${merchantIds[0]}/analytics` +
            `?from=${encodeURIComponent(analyticsFrom.toISOString())}` +
            `&to=${encodeURIComponent(analyticsTo.toISOString())}`,
          headers: { cookie: ownerCookie },
        }),
      );
      assert(
        response.statusCode === 200,
        `Analytics returned ${response.statusCode}.`,
      );
      const analytics = response.json().metrics as Record<string, number>;
      assert(
        analytics.searchAttempts === 10 &&
          analytics.catalogLoads === 5 &&
          analytics.paginationRequests === 5,
        'Merchant analytics regressed TASK-022 taxonomy.',
      );
      assert(
        analytics.attributedSales === Number(expected.orders) &&
          analytics.attributedGmvMinor === Number(expected.gross) &&
          analytics.netRevenueMinor === Number(expected.net) &&
          analytics.attributedGmvMinor - analytics.netRevenueMinor === 5_000,
        'Merchant analytics did not preserve cancellation/refund semantics.',
      );
      return {
        searchAttempts: analytics.searchAttempts,
        catalogLoads: analytics.catalogLoads,
        paginationRequests: analytics.paginationRequests,
        attributedSales: analytics.attributedSales,
        attributedGmvMinor: analytics.attributedGmvMinor,
        netRevenueMinor: analytics.netRevenueMinor,
      };
    });

    await scenario(scenarios, 'private-merchant', async () => {
      let rejected = false;
      try {
        await services.discoverySessions.create(
          { surface: 'web', merchant: merchantIds[3] as string },
          {
            transport: 'rest',
            anonymousUserId: deterministicUuid(`${seed}:private`),
          },
        );
      } catch (error) {
        rejected = Boolean(
          error &&
            typeof error === 'object' &&
            'statusCode' in error &&
            error.statusCode === 404,
        );
      }
      const result = await services.executePublicSearch(
        { merchantIds: [merchantIds[3] as string], query: 'Synthetic' },
        {},
        { transport: 'rest', surface: 'web' },
      );
      assert(
        rejected && result.products.length === 0,
        'Private merchant was public-discoverable.',
      );
      return { discoveryRejected: true, publicProducts: 0 };
    });
    await scenario(scenarios, 'cross-tenant', async () => {
      const rows = await withTenant(
        database.db,
        merchantIds[1] as string,
        (tx) =>
          tx
            .select({ id: products.id })
            .from(products)
            .where(eq(products.merchantId, merchantIds[0] as string))
            .limit(1),
      );
      assert(rows.length === 0, 'RLS exposed a product from another tenant.');
      return { leakedRows: rows.length };
    });

    await scenario(scenarios, 'retried-sync', async () => {
      const job = {
        schemaVersion: 1 as const,
        runId: deterministicUuid(`${seed}:retried-sync`),
        merchantId: merchantIds[1] as string,
        connectionId: connectionIds[1] as string,
        observedAt: new Date('2026-09-15T09:00:00.000Z').toISOString(),
        rows: [
          {
            externalId: 'retry-offer',
            productKey: 'retry-product',
            title: 'Retried Synthetic Product',
            description: '',
            category: 'tshirt',
            size: 'M',
            color: 'black',
            priceMinor: 12_345,
            currency: 'TRY' as const,
            available: true,
            checkoutUrl: 'https://checkout.synthetic.invalid/retry',
          },
        ],
      };
      const first = await importCatalog(database.db, job);
      const retry = await importCatalog(database.db, job);
      assert(
        first.imported === 1 && retry.duplicate,
        'Retried sync was not idempotent.',
      );
      return { firstImported: first.imported, retryDuplicate: retry.duplicate };
    });
    await scenario(scenarios, 'incremental-sync-updates', async () => {
      const unchangedIdentity = {
        externalId: 'm1-offer-0',
        productKey: 'm1-product-0',
        title: 'Synthetic Merchant 2 Product 1',
        description: 'Small deterministic synthetic catalog item',
        category: 'fishing-rod',
        imageUrl: 'https://images.synthetic.invalid/m1/0.jpg',
        imageAlt: 'Synthetic item 1',
        size: 'S',
        color: 'black',
        currency: 'TRY' as const,
        checkoutUrl: 'https://checkout.synthetic.invalid/m1/0',
      };
      const base = {
        schemaVersion: 1 as const,
        merchantId: merchantIds[1] as string,
        connectionId: connectionIds[1] as string,
      };
      const updated = await importCatalog(database.db, {
        ...base,
        runId: deterministicUuid(`${seed}:incremental-update`),
        observedAt: new Date('2026-09-15T10:00:00.000Z').toISOString(),
        rows: [{ ...unchangedIdentity, priceMinor: 19_999, available: true }],
      });
      const stale = await importCatalog(database.db, {
        ...base,
        runId: deterministicUuid(`${seed}:incremental-stale`),
        observedAt: new Date('2026-09-15T09:30:00.000Z').toISOString(),
        rows: [{ ...unchangedIdentity, priceMinor: 1, available: false }],
      });
      const persisted = await database.db.execute(sql`
        select o.price_minor as price, i.available
        from offers o join inventory i on i.offer_id = o.id
        where o.connection_id = ${connectionIds[1]} and o.external_id = 'm1-offer-0'
      `);
      const row = persisted.rows[0] as {
        price: string | number;
        available: boolean;
      };
      assert(
        updated.imported === 1 &&
          stale.stale === true &&
          Number(row.price) === 19_999 &&
          row.available === true,
        'Incremental price/inventory update or stale-write protection failed.',
      );
      return {
        updatedPriceMinor: Number(row.price),
        updatedAvailable: row.available,
        staleWriteIgnored: stale.stale,
      };
    });
    await scenario(scenarios, 'stale-catalog', () => {
      const now = Date.parse('2026-09-15T10:00:00.000Z');
      const health = catalogConnectionHealth(
        {
          active: true,
          authorizationStatus: 'active',
          lastSuccessfulSyncAt: new Date(now - 31 * 60_000),
          lastSyncError: null,
        },
        now,
      );
      assert(
        health === 'stale',
        'Stale catalog warning threshold did not fire.',
      );
      return { health, thresholdMinutes: 30 };
    });

    const totals = await database.db.execute(sql`
      select
        (select count(*)::int from merchants) as merchants,
        (select count(*)::int from products) as products,
        (select count(*)::int from product_view_events) as views,
        (select count(*)::int from redirect_clicks where classification='human') as clicks,
        (select count(*)::int from conversion_orders where search_id is not null and offer_id is not null and status <> 'cancelled') as orders,
        (select coalesce(sum(gross_minor),0)::bigint from conversion_orders where search_id is not null and offer_id is not null and status <> 'cancelled') as gmv,
        (select coalesce(sum(gross_minor-refunded_minor),0)::bigint from conversion_orders where search_id is not null and offer_id is not null and status <> 'cancelled') as net
    `);
    const total = totals.rows[0] as Record<string, number | string>;
    const metrics: RehearsalMetrics = {
      requestCount,
      successCount,
      errorCount,
      p50LatencyMs: percentile(latencies, 0.5),
      p95LatencyMs: percentile(latencies, 0.95),
      merchantCount: Number(total.merchants),
      productCount: Number(total.products),
      shopperJourneys: JOURNEY_COUNT,
      catalogLoads: Number(taxonomy.catalogLoads),
      searchAttempts: Number(taxonomy.searchAttempts),
      explicitSearches: Number(taxonomy.explicitSearches),
      refinements: Number(taxonomy.refinements),
      paginationRequests: Number(taxonomy.paginationRequests),
      productViews: Number(total.views),
      checkoutClicks: Number(total.clicks),
      conversionCallbacks,
      attributedOrders: Number(total.orders),
      attributedGmvMinor: Number(total.gmv),
      netRevenueMinor: Number(total.net),
      noResultRate:
        Number(taxonomy.emptySearches) / Number(taxonomy.successfulSearches),
      searchErrorRate:
        Number(taxonomy.failedSearches) / Number(taxonomy.searchAttempts),
      checkoutClickRate: Number(total.clicks) / Number(taxonomy.searchAttempts),
      conversionAttributionRate: Number(total.orders) / conversionCallbacks,
      syncFailures: scenarios.find(
        (item) => item.id === 'retry-exhaustion' && item.status === 'pass',
      )
        ? 1
        : 0,
      staleCatalogWarnings: scenarios.find(
        (item) => item.id === 'stale-catalog' && item.status === 'pass',
      )
        ? 1
        : 0,
      tenantIsolationViolations: scenarios.some(
        (item) =>
          ['private-merchant', 'cross-tenant'].includes(item.id) &&
          item.status === 'fail',
      )
        ? 1
        : 0,
    };
    const acceptance = acceptanceFrom({
      metrics,
      scenarios,
      webJourneys,
      chatgptJourneys,
      realMcpTransportTests,
    });
    const verdict = verdictFrom(acceptance);
    const finishedAt = new Date();
    const report = {
      schemaVersion: REPORT_SCHEMA_VERSION,
      mode: 'synthetic' as const,
      runMode: mode,
      seed,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      environment: {
        ci: Boolean(process.env.CI) || mode === 'ci',
        database: 'postgres',
        databaseName,
        concurrency: CONCURRENCY,
      },
      scale: {
        merchants: metrics.merchantCount,
        products: metrics.productCount,
        shopperJourneys: JOURNEY_COUNT,
        webJourneys,
        chatgptAttributedJourneys: chatgptJourneys,
      },
      transportCoverage: {
        webRestJourneys: webJourneys,
        chatgptAttributedJourneys: chatgptJourneys,
        realMcpTransportTests,
      },
      metrics,
      scenarios,
      acceptance,
      verdict,
      limitations: [
        'Synthetic merchants and deterministic fake upstream provider responses',
        'Synthetic shoppers and generated conversions',
        'Fake checkout destinations; no payment is attempted',
        'Trendyol Product V2 responses are synthetic; no real seller is contacted',
        'No real merchant/user acceptance; TASK-023B remains pending',
        'ChatGPT-attributed service journeys are not real MCP transport calls; real MCP HTTP tools/call coverage is reported separately',
      ],
    };
    const summary = renderSummary({
      metrics,
      acceptance,
      verdict,
      webJourneys,
      chatgptJourneys,
      realMcpTransportTests,
    });
    await mkdir(artifactsDirectory, { recursive: true });
    await writeFile(
      resolve(artifactsDirectory, 'report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    await writeFile(resolve(artifactsDirectory, 'summary.txt'), `${summary}\n`);
    process.stdout.write(`${summary}\n`);
    if (verdict === 'FAIL') process.exitCode = 1;
  } finally {
    await app.close();
    await database.close();
  }
}

main().catch(async (error) => {
  await mkdir(artifactsDirectory, { recursive: true });
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  const failed = failureReport({
    seed: failureSeed,
    runMode: failureRunMode,
    phase: failurePhase,
    startedAt: processStartedAt,
    finishedAt: new Date(),
    error: message,
  });
  await writeFile(
    resolve(artifactsDirectory, 'report.json'),
    `${JSON.stringify(failed, null, 2)}\n`,
  );
  await writeFile(
    resolve(artifactsDirectory, 'summary.txt'),
    `ShopAI Synthetic Pilot Rehearsal\n\nVerdict: FAIL\n\n${message}\n`,
  );
  console.error(message);
  process.exitCode = 1;
});
