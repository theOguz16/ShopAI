-- Additive cutover support. A verified email alone NEVER links an existing user.
ALTER TABLE oidc_auth_transactions ADD COLUMN IF NOT EXISTS claim_user_id uuid REFERENCES users(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE oidc_auth_transactions ADD COLUMN IF NOT EXISTS stepup_user_id uuid REFERENCES users(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE oidc_auth_transactions ADD COLUMN IF NOT EXISTS flow_kind text NOT NULL DEFAULT 'login';
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oidc_auth_transactions_flow_check') THEN
    ALTER TABLE oidc_auth_transactions ADD CONSTRAINT oidc_auth_transactions_flow_check
      CHECK (flow_kind IN ('login','stepup'));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS closed_at timestamptz;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sessions_user_revoked_idx ON sessions (user_id, revoked_at, expires_at);
--> statement-breakpoint
-- Authentication transaction tables stay unavailable to the public role.
REVOKE ALL ON TABLE oidc_auth_transactions, user_identities, auth_audit_events FROM shopai_public;
