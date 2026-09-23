-- ÜRÜN-003 phase 1: additive schema only. No pilot identity is promoted or linked by email.
-- The OIDC callback, invitation proof, session enforcement and cutover are NOT active.
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'pilot';
--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_account_status_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_account_status_check
      CHECK (account_status IN ('pilot', 'active', 'closing', 'closed'));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_active_at timestamptz;
--> statement-breakpoint
UPDATE sessions SET last_active_at = created_at WHERE last_active_at IS NULL;
--> statement-breakpoint
ALTER TABLE sessions ALTER COLUMN last_active_at SET DEFAULT now();
--> statement-breakpoint
ALTER TABLE sessions ALTER COLUMN last_active_at SET NOT NULL;
--> statement-breakpoint
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS absolute_expires_at timestamptz;
--> statement-breakpoint
UPDATE sessions SET absolute_expires_at = expires_at WHERE absolute_expires_at IS NULL;
--> statement-breakpoint
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
--> statement-breakpoint
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS auth_level text NOT NULL DEFAULT 'pilot';
--> statement-breakpoint
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS authenticated_at timestamptz;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_auth_level_check') THEN
    ALTER TABLE sessions ADD CONSTRAINT sessions_auth_level_check
      CHECK (auth_level IN ('pilot', 'password', 'mfa'));
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS user_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  issuer text NOT NULL,
  subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject),
  UNIQUE (user_id, issuer),
  CONSTRAINT user_identities_issuer_nonempty CHECK (length(issuer) > 0),
  CONSTRAINT user_identities_subject_nonempty CHECK (length(subject) > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS user_identities_user_idx ON user_identities (user_id);
--> statement-breakpoint
-- Only encrypted and encoded verifier ciphertext may be persisted here; the
-- calling service must atomically consume the state, bind it to the browser,
-- and discard ciphertext on consumption or expiry. Never store a raw verifier.
CREATE TABLE IF NOT EXISTS oidc_auth_transactions (
  state_hash text PRIMARY KEY,
  browser_binding_hash text NOT NULL,
  client_kind text NOT NULL CHECK (client_kind IN ('shopper', 'merchant')),
  nonce_hash text NOT NULL,
  pkce_verifier_ciphertext text NOT NULL,
  return_to text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS oidc_auth_transactions_expiry_idx ON oidc_auth_transactions (expires_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS auth_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN
    ('login', 'logout', 'logout_all', 'identity_link', 'mfa', 'recovery', 'account_closing', 'security')),
  outcome text NOT NULL CHECK (outcome IN ('success', 'failure', 'denied')),
  request_id text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS auth_audit_events_user_time_idx ON auth_audit_events (user_id, occurred_at);
--> statement-breakpoint
-- The public DB role has no direct rights on identity or audit tables.
REVOKE ALL ON TABLE user_identities, oidc_auth_transactions, auth_audit_events FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE user_identities, oidc_auth_transactions TO shopai_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE auth_audit_events TO shopai_app;
