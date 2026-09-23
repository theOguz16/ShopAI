CREATE TABLE connector_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  provider text NOT NULL,
  kind text NOT NULL DEFAULT 'catalog_credentials',
  reference text NOT NULL UNIQUE,
  version bigint NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT connector_secrets_merchant_connection_fk FOREIGN KEY (merchant_id, connection_id) REFERENCES source_connections(merchant_id, id),
  CONSTRAINT connector_secrets_connection_id_version_unique UNIQUE (connection_id, version),
  CONSTRAINT connector_secret_status CHECK (status IN ('active','rotated','revoked'))
);
--> statement-breakpoint
CREATE TABLE connector_secret_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  reference text NOT NULL,
  event text NOT NULL,
  actor text NOT NULL,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connector_secret_audit_merchant_connection_fk FOREIGN KEY (merchant_id, connection_id) REFERENCES source_connections(merchant_id, id),
  CONSTRAINT connector_secret_audit_event CHECK (event IN ('created','accessed','rotated','revoked','resolution_failed'))
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON connector_secrets TO shopai_app;
--> statement-breakpoint
GRANT SELECT ON connector_secrets TO shopai_worker;
--> statement-breakpoint
GRANT INSERT, SELECT ON connector_secret_audit TO shopai_app, shopai_worker;
--> statement-breakpoint
ALTER TABLE connector_secrets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE connector_secrets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE connector_secret_audit ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE connector_secret_audit FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_connector_secrets ON connector_secrets FOR ALL TO shopai_app USING (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY worker_connector_secrets ON connector_secrets FOR SELECT TO shopai_worker USING (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY tenant_connector_secret_audit ON connector_secret_audit FOR ALL TO shopai_app, shopai_worker USING (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
