import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './schema.js';

const at = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' });

// Only the verified (issuer, subject) pair identifies an OIDC account.
// Email must never be used to upsert or automatically link a pilot user.
export const userIdentities = pgTable(
  'user_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('user_identities_issuer_subject_unique').on(t.issuer, t.subject),
    unique('user_identities_user_issuer_unique').on(t.userId, t.issuer),
    check('user_identities_issuer_nonempty', sql`length(${t.issuer}) > 0`),
    check('user_identities_subject_nonempty', sql`length(${t.subject}) > 0`),
    index('user_identities_user_idx').on(t.userId),
  ],
);

// This table is not wired into an endpoint yet. The future OIDC service must
// store *encrypted* verifier ciphertext, hash state/nonce/browser binding,
// atomically consume the record once, and reject expired records.
export const oidcAuthTransactions = pgTable(
  'oidc_auth_transactions',
  {
    stateHash: text('state_hash').primaryKey(),
    browserBindingHash: text('browser_binding_hash').notNull(),
    clientKind: text('client_kind').notNull(),
    nonceHash: text('nonce_hash').notNull(),
    pkceVerifierCiphertext: text('pkce_verifier_ciphertext').notNull(),
    returnTo: text('return_to').notNull(),
    expiresAt: at('expires_at').notNull(),
    consumedAt: at('consumed_at'),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('oidc_auth_transactions_client_kind_check', sql`${t.clientKind} in ('shopper','merchant')`),
    index('oidc_auth_transactions_expiry_idx').on(t.expiresAt),
  ],
);

// Intentional allowlist: no cookies, codes, tokens, IP addresses or PII payload.
export const authAuditEvents = pgTable(
  'auth_audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    eventType: text('event_type').notNull(),
    outcome: text('outcome').notNull(),
    requestId: text('request_id'),
    occurredAt: at('occurred_at').notNull().defaultNow(),
  },
  (t) => [
    check('auth_audit_events_event_type_check', sql`${t.eventType} in ('login','logout','logout_all','identity_link','mfa','recovery','account_closing','security')`),
    check('auth_audit_events_outcome_check', sql`${t.outcome} in ('success','failure','denied')`),
    index('auth_audit_events_user_time_idx').on(t.userId, t.occurredAt),
  ],
);
