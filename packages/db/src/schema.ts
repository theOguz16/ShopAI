import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const at = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' });
export const merchants = pgTable(
  'merchants',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    displayName: text('display_name'),
    logoUrl: text('logo_url'),
    coverImageUrl: text('cover_image_url'),
    primaryColor: text('primary_color').notNull().default('#111111'),
    isPublic: boolean('is_public').notNull().default(false),
    active: boolean('active').notNull().default(false),
  },
  (t) => [
    check(
      'merchant_primary_color',
      sql`${t.primaryColor} ~ '^#[0-9A-Fa-f]{6}$'`,
    ),
  ],
);
export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  createdAt: at('created_at').notNull().defaultNow(),
});
export const sessions = pgTable('sessions', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: at('expires_at').notNull(),
  createdAt: at('created_at').notNull().defaultNow(),
});
export const discoverySessions = pgTable(
  'discovery_sessions',
  {
    id: id(),
    surface: text('surface').notNull(),
    transport: text('transport').notNull(),
    merchantScope: jsonb('merchant_scope')
      .$type<string[]>()
      .notNull()
      .default([]),
    referrer: text('referrer'),
    campaign: text('campaign'),
    anonymousUserId: uuid('anonymous_user_id').notNull(),
    userId: uuid('user_id').references(() => users.id),
    createdAt: at('created_at').notNull().defaultNow(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'discovery_session_transport',
      sql`${t.transport} in ('rest','mcp','ucp')`,
    ),
    check(
      'discovery_session_surface',
      sql`${t.surface} in ('web','chatgpt','gemini','brand_widget')`,
    ),
    check(
      'discovery_session_merchant_scope_array',
      sql`jsonb_typeof(${t.merchantScope}) = 'array'`,
    ),
    index('discovery_sessions_surface_created').on(t.surface, t.createdAt),
    index('discovery_sessions_anonymous_user').on(
      t.anonymousUserId,
      t.createdAt,
    ),
  ],
);
export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id),
    role: text('role').notNull(),
  },
  (t) => [
    unique().on(t.userId, t.merchantId),
    check('membership_role', sql`${t.role} in ('owner','editor','viewer')`),
  ],
);
export const connections = pgTable(
  'source_connections',
  {
    id: id(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id),
    provider: text('provider').notNull(),
    credentialsRef: text('credentials_ref'),
    active: boolean('active').notNull().default(true),
    authorizationStatus: text('authorization_status')
      .notNull()
      .default('pending'),
    syncMode: text('sync_mode').notNull().default('incremental'),
    syncCursor: text('sync_cursor'),
    lastSyncStartedAt: at('last_sync_started_at'),
    lastSuccessfulSyncAt: at('last_successful_sync_at'),
    lastFetchedAt: at('last_fetched_at'),
    lastSyncError: text('last_sync_error'),
    revokedAt: at('revoked_at'),
    conversionTrackingEnabled: boolean('conversion_tracking_enabled')
      .notNull()
      .default(false),
  },
  (t) => [
    unique().on(t.merchantId, t.id),
    check(
      'connection_authorization_status',
      sql`${t.authorizationStatus} in ('pending','active','reauthorization_required','revoked')`,
    ),
    check('connection_sync_mode', sql`${t.syncMode} in ('full','incremental')`),
  ],
);
export const merchantCredentialOwnerships = pgTable(
  'merchant_credential_ownerships',
  {
    id: id(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id),
    provider: text('provider').notNull(),
    credentialsRef: text('credentials_ref').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.merchantId, t.provider, t.credentialsRef),
    unique().on(t.provider, t.credentialsRef),
  ],
);
export const products = pgTable(
  'products',
  {
    id: id(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id),
    connectionId: uuid('connection_id').notNull(),
    externalKey: text('external_key').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    category: text('category').notNull(),
    published: boolean('published').notNull().default(false),
    imageUrl: text('image_url'),
    imageAlt: text('image_alt'),
    publicationChangedAt: at('publication_changed_at'),
    publicationChangedBy: uuid('publication_changed_by').references(
      () => users.id,
    ),
    observedAt: at('observed_at').notNull(),
    fetchedAt: at('fetched_at').notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.merchantId, t.id),
    unique().on(t.connectionId, t.externalKey),
    foreignKey({
      columns: [t.merchantId, t.connectionId],
      foreignColumns: [connections.merchantId, connections.id],
    }),
    index('products_public_category').on(t.published, t.category),
  ],
);
export const variants = pgTable(
  'variants',
  {
    id: id(),
    merchantId: uuid('merchant_id').notNull(),
    productId: uuid('product_id').notNull(),
    connectionId: uuid('connection_id').notNull(),
    externalId: text('external_id').notNull(),
    size: text('size').notNull(),
    color: text('color').notNull(),
    observedAt: at('observed_at').notNull(),
    fetchedAt: at('fetched_at').notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.merchantId, t.id),
    unique().on(t.connectionId, t.externalId),
    foreignKey({
      columns: [t.merchantId, t.productId],
      foreignColumns: [products.merchantId, products.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.connectionId],
      foreignColumns: [connections.merchantId, connections.id],
    }),
  ],
);
export const offers = pgTable(
  'offers',
  {
    id: id(),
    merchantId: uuid('merchant_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    connectionId: uuid('connection_id').notNull(),
    externalId: text('external_id').notNull(),
    priceMinor: bigint('price_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    checkoutUrl: text('checkout_url').notNull(),
    active: boolean('active').notNull().default(true),
    observedAt: at('observed_at').notNull(),
    fetchedAt: at('fetched_at').notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.merchantId, t.id),
    unique().on(t.connectionId, t.externalId),
    foreignKey({
      columns: [t.merchantId, t.variantId],
      foreignColumns: [variants.merchantId, variants.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.connectionId],
      foreignColumns: [connections.merchantId, connections.id],
    }),
    check(
      'offer_price_safe',
      sql`${t.priceMinor} >= 0 and ${t.priceMinor} <= 9007199254740991`,
    ),
    check('offer_currency', sql`${t.currency} = 'TRY'`),
  ],
);
export const inventory = pgTable(
  'inventory',
  {
    offerId: uuid('offer_id').primaryKey(),
    merchantId: uuid('merchant_id').notNull(),
    available: boolean('available'),
    observedAt: at('observed_at').notNull(),
    fetchedAt: at('fetched_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.merchantId, t.offerId],
      foreignColumns: [offers.merchantId, offers.id],
    }),
  ],
);
export const redirectClicks = pgTable(
  'redirect_clicks',
  {
    id: id(),
    searchId: uuid('search_id').notNull(),
    discoverySessionId: uuid('discovery_session_id').references(
      () => discoverySessions.id,
    ),
    offerId: uuid('offer_id').notNull(),
    productId: uuid('product_id').notNull(),
    merchantId: uuid('merchant_id').notNull(),
    transport: text('transport').notNull(),
    surface: text('surface').notNull(),
    campaign: text('campaign'),
    classification: text('classification').notNull(),
    occurredAt: at('occurred_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.merchantId, t.offerId],
      foreignColumns: [offers.merchantId, offers.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.productId],
      foreignColumns: [products.merchantId, products.id],
    }),
    check(
      'redirect_click_transport',
      sql`${t.transport} in ('rest','mcp','ucp')`,
    ),
    check(
      'redirect_click_surface',
      sql`${t.surface} in ('web','chatgpt','gemini','brand_widget')`,
    ),
    check(
      'redirect_click_classification',
      sql`${t.classification} in ('human','bot')`,
    ),
    index('redirect_clicks_reporting').on(
      t.merchantId,
      t.occurredAt,
      t.classification,
    ),
    index('redirect_clicks_surface_reporting').on(
      t.merchantId,
      t.surface,
      t.occurredAt,
    ),
    index('redirect_clicks_campaign_reporting').on(
      t.merchantId,
      t.campaign,
      t.occurredAt,
    ),
    index('redirect_clicks_discovery_session').on(
      t.discoverySessionId,
      t.occurredAt,
    ),
  ],
);
export const searchEvents = pgTable(
  'search_events',
  {
    id: id(),
    searchId: uuid('search_id'),
    discoverySessionId: uuid('discovery_session_id').references(
      () => discoverySessions.id,
    ),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id),
    transport: text('transport').notNull(),
    surface: text('surface').notNull(),
    requestKind: text('request_kind').notNull(),
    outcome: text('outcome').notNull(),
    occurredAt: at('occurred_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'search_event_transport',
      sql`${t.transport} in ('rest','mcp','ucp')`,
    ),
    check(
      'search_event_surface',
      sql`${t.surface} in ('web','chatgpt','gemini','brand_widget')`,
    ),
    check(
      'search_event_request_kind',
      sql`${t.requestKind} in ('initial','pagination')`,
    ),
    check(
      'search_event_outcome',
      sql`${t.outcome} in ('results','empty','error')`,
    ),
    index('search_events_reporting').on(
      t.merchantId,
      t.occurredAt,
      t.requestKind,
    ),
    index('search_events_surface_reporting').on(
      t.merchantId,
      t.surface,
      t.occurredAt,
    ),
    index('search_events_discovery_session').on(
      t.discoverySessionId,
      t.occurredAt,
    ),
  ],
);
export const conversionOrders = pgTable(
  'conversion_orders',
  {
    id: id(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id),
    connectionId: uuid('connection_id').notNull(),
    externalOrderId: text('external_order_id').notNull(),
    status: text('status').notNull(),
    currency: text('currency').notNull(),
    grossMinor: bigint('gross_minor', { mode: 'number' }).notNull(),
    refundedMinor: bigint('refunded_minor', { mode: 'number' })
      .notNull()
      .default(0),
    searchId: uuid('search_id'),
    offerId: uuid('offer_id'),
    transport: text('transport'),
    surface: text('surface'),
    occurredAt: at('occurred_at').notNull(),
    receivedAt: at('received_at').notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.merchantId, t.id),
    unique().on(t.connectionId, t.externalOrderId),
    foreignKey({
      columns: [t.merchantId, t.connectionId],
      foreignColumns: [connections.merchantId, connections.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.offerId],
      foreignColumns: [offers.merchantId, offers.id],
    }),
    check(
      'conversion_order_status',
      sql`${t.status} in ('paid','cancelled','refunded')`,
    ),
    check('conversion_order_currency', sql`${t.currency} = 'TRY'`),
    check(
      'conversion_order_transport',
      sql`${t.transport} in ('rest','mcp','ucp')`,
    ),
    check(
      'conversion_order_surface',
      sql`${t.surface} in ('web','chatgpt','gemini','brand_widget')`,
    ),
    check(
      'conversion_order_amounts',
      sql`${t.grossMinor} >= 0 and ${t.refundedMinor} >= 0 and ${t.refundedMinor} <= ${t.grossMinor}`,
    ),
    index('conversion_orders_reporting').on(t.merchantId, t.occurredAt),
    index('conversion_orders_surface_reporting').on(
      t.merchantId,
      t.surface,
      t.occurredAt,
    ),
  ],
);
export const importRuns = pgTable(
  'import_runs',
  {
    id: uuid('id').primaryKey(),
    merchantId: uuid('merchant_id').notNull(),
    connectionId: uuid('connection_id').notNull(),
    rows: bigint('row_count', { mode: 'number' }).notNull(),
    observedAt: at('observed_at').notNull(),
    status: text('status').notNull().default('pending'),
    filePath: text('file_path').notNull(),
    error: jsonb('error'),
    completedAt: at('completed_at'),
  },
  (t) => [
    unique().on(t.merchantId, t.id),
    check(
      'import_run_status',
      sql`${t.status} in ('pending','validating','processing','completed','failed')`,
    ),
    foreignKey({
      columns: [t.merchantId, t.connectionId],
      foreignColumns: [connections.merchantId, connections.id],
    }),
  ],
);
export const importOutboxEvents = pgTable(
  'import_outbox_events',
  {
    id: id(),
    runId: uuid('run_id').notNull().unique(),
    merchantId: uuid('merchant_id').notNull(),
    payload: jsonb('payload').notNull(),
    attempts: bigint('attempts', { mode: 'number' }).notNull().default(0),
    availableAt: at('available_at').notNull().defaultNow(),
    publishedAt: at('published_at'),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.merchantId, t.runId],
      foreignColumns: [importRuns.merchantId, importRuns.id],
    }),
  ],
);
