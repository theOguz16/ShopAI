import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import { parseApiEnv } from '../../apps/api/src/env.js';
import { createServices } from '../../apps/api/src/services.js';
import {
  anonymousShoppingProfiles,
  createDatabase,
  discoverySessions,
} from '../../packages/db/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

function cookieFrom(response: { headers: Record<string, unknown> }) {
  const value = response.headers['set-cookie'];
  const header = Array.isArray(value) ? value[0] : value;
  return typeof header === 'string' ? header.split(';')[0] : '';
}

describeWithDatabase('anonymous shopping profile', () => {
  if (!databaseUrl) return;

  const env = parseApiEnv({
    CATALOG_MODE: 'postgres',
    DATABASE_URL: databaseUrl,
    MCP_PUBLIC_ORIGIN: 'https://api.test.example',
    WIDGET_ORIGIN: 'https://widget.test.example',
    REDIRECT_SIGNING_SECRET: 'anonymous-profile-redirect-secret-00000000000',
    CONVERSION_CALLBACK_SECRET: 'anonymous-profile-conversion-secret-000000000',
    UPLOAD_DIR: '/tmp/shopai-anonymous-profile-uploads',
  });
  const database = createDatabase(databaseUrl);
  const services = createServices(env);
  let app: Awaited<ReturnType<typeof buildApp>>;
  let firstCookie = '';
  let firstAnonymousUserId = '';

  beforeAll(async () => {
    await database.db.execute(
      sql`truncate table ${anonymousShoppingProfiles}, ${discoverySessions} cascade`,
    );
    app = await buildApp(services, env);
  });

  afterAll(async () => {
    await app.close();
    await database.close();
  });

  it('creates a first-party anonymous profile and persists explicit T-Shirt size M', async () => {
    const initial = await app.inject({
      method: 'GET',
      url: '/v1/shopping-profile',
    });
    expect(initial.statusCode).toBe(200);
    firstCookie = cookieFrom(initial);
    expect(firstCookie).toMatch(/^shopai_anonymous_user_id=/u);
    expect(String(initial.headers['set-cookie'])).toContain('HttpOnly');
    expect(String(initial.headers['set-cookie'])).toContain('SameSite=Lax');

    const initialProfile = initial.json();
    firstAnonymousUserId = initialProfile.anonymousUserId;
    expect(firstAnonymousUserId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
    expect(initialProfile.preferredSizes).toEqual({});

    const update = await app.inject({
      method: 'PUT',
      url: '/v1/shopping-profile',
      headers: { cookie: firstCookie },
      payload: { category: 'tshirt', preferredSizes: ['M'] },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({
      anonymousUserId: firstAnonymousUserId,
      preferredSizes: { tshirt: ['M'] },
    });

    const nextVisit = await app.inject({
      method: 'GET',
      url: '/v1/shopping-profile',
      headers: { cookie: firstCookie },
    });
    expect(nextVisit.statusCode).toBe(200);
    expect(nextVisit.json()).toMatchObject({
      anonymousUserId: firstAnonymousUserId,
      preferredSizes: { tshirt: ['M'] },
    });
  });

  it('does not change profile preferences from search behavior', async () => {
    const search = await app.inject({
      method: 'POST',
      url: '/v1/search',
      headers: { cookie: firstCookie },
      payload: {
        query: 'L beden pantolon',
        filters: { sizes: ['L'] },
      },
    });
    expect(search.statusCode).toBe(200);
    expect(JSON.stringify(search.json())).not.toContain(firstAnonymousUserId);

    const profile = await app.inject({
      method: 'GET',
      url: '/v1/shopping-profile',
      headers: { cookie: firstCookie },
    });
    expect(profile.json()).toMatchObject({
      preferredSizes: { tshirt: ['M'] },
      preferredColors: {},
      preferredStyles: {},
      preferredPriceRanges: {},
    });
    expect(profile.json().preferredSizes.trousers).toBeUndefined();
  });

  it('isolates different anonymous cookies and prevents discovery identity spoofing', async () => {
    const second = await app.inject({
      method: 'GET',
      url: '/v1/shopping-profile',
    });
    expect(second.statusCode).toBe(200);
    const secondProfile = second.json();
    expect(secondProfile.anonymousUserId).not.toBe(firstAnonymousUserId);
    expect(secondProfile.preferredSizes).toEqual({});

    const spoofedId = randomUUID();
    const discovery = await app.inject({
      method: 'POST',
      url: '/discovery-session',
      headers: { cookie: firstCookie },
      payload: { surface: 'web', anonymousUserId: spoofedId },
    });
    expect(discovery.statusCode).toBe(201);
    expect(discovery.json().anonymousUserId).toBe(firstAnonymousUserId);
    expect(discovery.json().anonymousUserId).not.toBe(spoofedId);
  });

  it('enforces anonymous RLS and gives merchant application role no profile access', async () => {
    const ownRows = await database.db.transaction(async (tx) => {
      await tx.execute(sql`set local role shopai_public`);
      await tx.execute(
        sql`select set_config('app.anonymous_user_id', ${firstAnonymousUserId}, true)`,
      );
      return tx
        .select({ anonymousUserId: anonymousShoppingProfiles.anonymousUserId })
        .from(anonymousShoppingProfiles);
    });
    expect(ownRows).toEqual([{ anonymousUserId: firstAnonymousUserId }]);

    await expect(
      database.db.transaction(async (tx) => {
        await tx.execute(sql`set local role shopai_app`);
        return tx
          .select({
            anonymousUserId: anonymousShoppingProfiles.anonymousUserId,
          })
          .from(anonymousShoppingProfiles)
          .where(
            eq(anonymousShoppingProfiles.anonymousUserId, firstAnonymousUserId),
          );
      }),
    ).rejects.toThrow();
  });
});
