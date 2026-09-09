import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import { parseApiEnv } from '../../apps/api/src/env.js';
import { createDatabase } from '../../packages/db/src/client.js';
import {
  connections,
  memberships,
  merchantCredentialOwnerships,
  merchants,
  users,
} from '../../packages/db/src/schema.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error('merchant-management.test için DATABASE_URL gerekli.');

const merchantA = 'da000000-0000-4000-8000-000000000001';
const merchantB = 'db000000-0000-4000-8000-000000000001';
const connectionB = 'db000000-0000-4000-8000-000000000002';
const credentialsA = 'secret://MANAGEMENT_WOO_A';
const credentialsB = 'secret://MANAGEMENT_WOO_B';
const credentials = {
  'owner-a@management.test': 'owner-a-management-token',
  'owner-b@management.test': 'owner-b-management-token',
  'editor-a@management.test': 'editor-a-management-token',
  'viewer-a@management.test': 'viewer-a-management-token',
  'bootstrap@management.test': 'bootstrap-management-token',
};
const env = parseApiEnv({
  CATALOG_MODE: 'postgres',
  DATABASE_URL: databaseUrl,
  MCP_PUBLIC_ORIGIN: 'https://api.management.test',
  WIDGET_ORIGIN: 'https://widget.management.test',
  REDIRECT_SIGNING_SECRET: 'management-redirect-secret-000000000000000',
  AUTH_PILOT_CREDENTIALS: JSON.stringify(credentials),
  UPLOAD_DIR: '/tmp/shopai-management-uploads',
  LOG_LEVEL: 'silent',
});
const adminDatabase = createDatabase(databaseUrl, {
  applicationName: 'shopai-management-fixtures',
});
let app: Awaited<ReturnType<typeof buildApp>>;
const cookies = new Map<keyof typeof credentials, string>();
const userIds = new Map<keyof typeof credentials, string>();

async function login(email: keyof typeof credentials) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { email, token: credentials[email] },
  });
  expect(response.statusCode).toBe(200);
  const cookie = response.headers['set-cookie']?.split(';')[0];
  if (!cookie) throw new Error(`${email} oturum cookie'si oluşturulamadı.`);
  cookies.set(email, cookie);
  const [user] = await adminDatabase.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (!user) throw new Error(`${email} kullanıcısı oluşturulamadı.`);
  userIds.set(email, user.id);
}

const auth = (email: keyof typeof credentials) => ({
  cookie: cookies.get(email) ?? '',
});
const userId = (email: keyof typeof credentials) => {
  const id = userIds.get(email);
  if (!id) throw new Error(`${email} fixture kullanıcısı bulunamadı.`);
  return id;
};

beforeAll(async () => {
  await adminDatabase.db.execute(
    sql`truncate table ${connections}, ${merchantCredentialOwnerships}, ${memberships}, ${users}, ${merchants} cascade`,
  );
  await adminDatabase.db.insert(merchants).values([
    {
      id: merchantA,
      name: 'Management A',
      slug: `management-a-${randomUUID()}`,
      active: true,
    },
    {
      id: merchantB,
      name: 'Management B',
      slug: `management-b-${randomUUID()}`,
      active: true,
    },
  ]);
  await adminDatabase.db.insert(connections).values({
    id: connectionB,
    merchantId: merchantB,
    provider: 'woocommerce',
    credentialsRef: credentialsB,
    authorizationStatus: 'active',
  });
  await adminDatabase.db.insert(merchantCredentialOwnerships).values([
    {
      merchantId: merchantA,
      provider: 'woocommerce',
      credentialsRef: credentialsA,
    },
    {
      merchantId: merchantB,
      provider: 'woocommerce',
      credentialsRef: credentialsB,
    },
  ]);

  app = await buildApp(undefined, env);
  await Promise.all(
    (Object.keys(credentials) as Array<keyof typeof credentials>).map(login),
  );
  await adminDatabase.db.insert(memberships).values([
    {
      userId: userId('owner-a@management.test'),
      merchantId: merchantA,
      role: 'owner',
    },
    {
      userId: userId('owner-b@management.test'),
      merchantId: merchantB,
      role: 'owner',
    },
    {
      userId: userId('editor-a@management.test'),
      merchantId: merchantA,
      role: 'editor',
    },
    {
      userId: userId('viewer-a@management.test'),
      merchantId: merchantA,
      role: 'viewer',
    },
  ]);
});

afterAll(async () => {
  await app.close();
  await adminDatabase.close();
});

describe.sequential('merchant management authorization', () => {
  it('enforces connection roles and tenant boundaries over HTTP', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/v1/merchants/${merchantA}/connections`,
      headers: auth('editor-a@management.test'),
      payload: {
        provider: 'woocommerce',
        credentialsRef: credentialsA,
        syncMode: 'incremental',
      },
    });
    expect(created.statusCode).toBe(201);
    const connectionA = created.json<{ connection: { id: string } }>()
      .connection.id;

    for (const email of [
      'owner-a@management.test',
      'editor-a@management.test',
      'viewer-a@management.test',
    ] as const) {
      const listed = await app.inject({
        method: 'GET',
        url: `/v1/merchants/${merchantA}/connections`,
        headers: auth(email),
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.json()).toEqual([
        expect.objectContaining({ id: connectionA, provider: 'woocommerce' }),
      ]);
    }

    const crossList = await app.inject({
      method: 'GET',
      url: `/v1/merchants/${merchantB}/connections`,
      headers: auth('owner-a@management.test'),
    });
    expect(crossList.statusCode).toBe(403);

    const viewerCreate = await app.inject({
      method: 'POST',
      url: `/v1/merchants/${merchantA}/connections`,
      headers: auth('viewer-a@management.test'),
      payload: { provider: 'csv' },
    });
    expect(viewerCreate.statusCode).toBe(403);

    const crossCreate = await app.inject({
      method: 'POST',
      url: `/v1/merchants/${merchantA}/connections`,
      headers: auth('owner-a@management.test'),
      payload: {
        provider: 'woocommerce',
        credentialsRef: credentialsB,
      },
    });
    expect(crossCreate.statusCode).toBe(403);

    const editorDelete = await app.inject({
      method: 'DELETE',
      url: `/v1/merchants/${merchantA}/connections/${connectionA}`,
      headers: auth('editor-a@management.test'),
    });
    expect(editorDelete.statusCode).toBe(403);
    expect(
      await adminDatabase.db
        .select({ active: connections.active })
        .from(connections)
        .where(eq(connections.id, connectionA)),
    ).toEqual([{ active: true }]);

    const crossDelete = await app.inject({
      method: 'DELETE',
      url: `/v1/merchants/${merchantA}/connections/${connectionB}`,
      headers: auth('owner-a@management.test'),
    });
    expect(crossDelete.statusCode).toBe(404);
    expect(
      await adminDatabase.db
        .select({ active: connections.active })
        .from(connections)
        .where(eq(connections.id, connectionB)),
    ).toEqual([{ active: true }]);

    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/v1/merchants/${merchantA}/connections/${connectionA}`,
          headers: auth('owner-a@management.test'),
        })
      ).statusCode,
    ).toBe(200);

    const editorReauthorize = await app.inject({
      method: 'POST',
      url: `/v1/merchants/${merchantA}/connections/${connectionA}/reauthorize`,
      headers: auth('editor-a@management.test'),
      payload: { credentialsRef: credentialsA },
    });
    expect(editorReauthorize.statusCode).toBe(403);

    const crossReauthorize = await app.inject({
      method: 'POST',
      url: `/v1/merchants/${merchantA}/connections/${connectionA}/reauthorize`,
      headers: auth('owner-a@management.test'),
      payload: { credentialsRef: credentialsB },
    });
    expect(crossReauthorize.statusCode).toBe(403);
    expect(
      await adminDatabase.db
        .select({
          active: connections.active,
          status: connections.authorizationStatus,
        })
        .from(connections)
        .where(eq(connections.id, connectionA)),
    ).toEqual([{ active: false, status: 'revoked' }]);

    const ownReauthorize = await app.inject({
      method: 'POST',
      url: `/v1/merchants/${merchantA}/connections/${connectionA}/reauthorize`,
      headers: auth('owner-a@management.test'),
      payload: { credentialsRef: credentialsA },
    });
    expect(ownReauthorize.statusCode).toBe(200);
  });

  it('allows only owners to manage memberships', async () => {
    const inviteeId = userIds.get('bootstrap@management.test');
    if (!inviteeId) throw new Error('Davet edilecek kullanıcı bulunamadı.');

    for (const email of [
      'editor-a@management.test',
      'viewer-a@management.test',
    ] as const) {
      const denied = await app.inject({
        method: 'POST',
        url: `/v1/merchants/${merchantA}/members`,
        headers: auth(email),
        payload: { userId: inviteeId, role: 'viewer' },
      });
      expect(denied.statusCode).toBe(403);
    }
    const crossTenant = await app.inject({
      method: 'POST',
      url: `/v1/merchants/${merchantB}/members`,
      headers: auth('owner-a@management.test'),
      payload: { userId: inviteeId, role: 'viewer' },
    });
    expect(crossTenant.statusCode).toBe(403);
    expect(
      await adminDatabase.db
        .select()
        .from(memberships)
        .where(eq(memberships.userId, inviteeId)),
    ).toEqual([]);

    const allowed = await app.inject({
      method: 'POST',
      url: `/v1/merchants/${merchantA}/members`,
      headers: auth('owner-a@management.test'),
      payload: { userId: inviteeId, role: 'viewer' },
    });
    expect(allowed.statusCode).toBe(201);
    expect(allowed.json().membership).toMatchObject({
      merchantId: merchantA,
      userId: inviteeId,
      role: 'viewer',
    });
  });

  it('creates one merchant and membership for concurrent setup requests', async () => {
    const bootstrapUserId = userIds.get('bootstrap@management.test');
    if (!bootstrapUserId) throw new Error('Bootstrap kullanıcısı bulunamadı.');
    await adminDatabase.db
      .delete(memberships)
      .where(eq(memberships.userId, bootstrapUserId));

    const responses = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/v1/setup/merchant',
        headers: auth('bootstrap@management.test'),
        payload: { name: 'Concurrent One' },
      }),
      app.inject({
        method: 'POST',
        url: '/v1/setup/merchant',
        headers: auth('bootstrap@management.test'),
        payload: { name: 'Concurrent Two' },
      }),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      201, 409,
    ]);

    const createdMemberships = await adminDatabase.db
      .select({ merchantId: memberships.merchantId })
      .from(memberships)
      .where(eq(memberships.userId, bootstrapUserId));
    expect(createdMemberships).toHaveLength(1);
    const createdMerchantId = createdMemberships[0]?.merchantId;
    if (!createdMerchantId) throw new Error('Kurulan mağaza bulunamadı.');
    expect(
      await adminDatabase.db
        .select({ id: merchants.id })
        .from(merchants)
        .where(eq(merchants.id, createdMerchantId)),
    ).toHaveLength(1);
  });
});
