import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import { createDatabase } from '../../packages/db/src/index.js';
import {
  discoverySessions,
  merchants,
  offers,
  searchEvents,
  users,
} from '../../packages/db/src/schema.js';
import { eq } from 'drizzle-orm';

const database = createDatabase();
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const userId = 'dc000000-0000-4000-8000-000000000001';
const maviId = 'da000000-0000-4000-8000-000000000001';
const privateMerchantId = 'da000000-0000-4000-8000-000000000002';

async function reset() {
  await database.db.delete(searchEvents);
  await database.db.delete(discoverySessions);
  await database.db.delete(offers);
  await database.db.delete(merchants);
  await database.db.delete(users);
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await reset();
});

describe('discovery sessions', () => {
  it('resolves redirect discovery attribution server-side without exposing session id in the token', async () => {
    await reset();
    const app = await buildApp();
    apps.push(app);

    const created = await app.inject({
      method: 'POST',
      url: '/discovery-session',
      payload: {
        surface: 'web',
        merchantScope: [maviId],
        campaign: 'instagram_bio',
        referrer: 'https://instagram.com/mavi',
      },
    });
    expect(created.statusCode).toBe(201);
    const session = created.json<{
      id: string;
      surface: string;
      transport: string;
      merchantScope: string[];
      campaign: string;
      userId: string | null;
    }>();
    expect(session).toMatchObject({
      surface: 'web',
      transport: 'rest',
      merchantScope: [maviId],
      campaign: 'instagram_bio',
      userId: null,
    });

    const search = await app.inject({
      method: 'POST',
      url: `/v1/stores/${maviId}/search`,
      payload: { query: 'Mavi Ürün', discoverySessionId: session.id },
    });
    expect(search.statusCode).toBe(200);
    const searchBody = search.json<{
      searchId: string;
      products: Array<{ checkoutUrl: string }>;
    }>();
    expect(searchBody.products).toHaveLength(1);

    const [searchEvent] = await database.db
      .select({
        searchId: searchEvents.searchId,
        discoverySessionId: searchEvents.discoverySessionId,
      })
      .from(searchEvents)
      .where(eq(searchEvents.searchId, searchBody.searchId));
    expect(searchEvent).toEqual({
      searchId: searchBody.searchId,
      discoverySessionId: session.id,
    });

    const redirectPath = new URL(searchBody.products[0]?.checkoutUrl ?? '')
      .pathname;
    const token = redirectPath.slice('/r/'.length);
    const payloadPart = token.split('.')[0] ?? '';
    const tokenPayload = JSON.parse(
      Buffer.from(payloadPart, 'base64url').toString('utf8'),
    );
    expect(tokenPayload).toMatchObject({
      searchId: searchBody.searchId,
      transport: 'rest',
      surface: 'web',
    });
    expect(tokenPayload).not.toHaveProperty('discoverySessionId');
  });

  it('uses an empty merchant scope for network-wide discovery', async () => {
    await reset();
    const app = await buildApp();
    apps.push(app);
    const created = await app.inject({
      method: 'POST',
      url: '/discovery-session',
      payload: { surface: 'web', merchantScope: [] },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().merchantScope).toEqual([]);
  });

  it('rejects chatgpt on the REST discovery-session endpoint', async () => {
    await reset();
    const app = await buildApp();
    apps.push(app);
    const created = await app.inject({
      method: 'POST',
      url: '/discovery-session',
      payload: { surface: 'chatgpt', merchantScope: [] },
    });
    expect(created.statusCode).toBe(400);
  });

  it('rejects gemini on the REST discovery-session endpoint', async () => {
    await reset();
    const app = await buildApp();
    apps.push(app);
    const created = await app.inject({
      method: 'POST',
      url: '/discovery-session',
      payload: { surface: 'gemini', merchantScope: [] },
    });
    expect(created.statusCode).toBe(400);
  });

  it('accepts brand_widget on the REST discovery-session endpoint', async () => {
    await reset();
    const app = await buildApp();
    apps.push(app);
    const created = await app.inject({
      method: 'POST',
      url: '/discovery-session',
      payload: { surface: 'brand_widget', merchantScope: [] },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      surface: 'brand_widget',
      transport: 'rest',
    });
  });
});
