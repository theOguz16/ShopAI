CREATE TABLE "merchant_credential_ownerships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"credentials_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_credential_ownerships_merchant_id_provider_credentials_ref_unique" UNIQUE("merchant_id","provider","credentials_ref"),
	CONSTRAINT "merchant_credential_ownerships_provider_credentials_ref_unique" UNIQUE("provider","credentials_ref")
);
--> statement-breakpoint
ALTER TABLE "merchant_credential_ownerships" ADD CONSTRAINT "merchant_credential_ownerships_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
GRANT SELECT, INSERT ON merchant_credential_ownerships TO shopai_app;
--> statement-breakpoint
GRANT SELECT ON merchant_credential_ownerships TO shopai_worker;
--> statement-breakpoint
ALTER TABLE merchant_credential_ownerships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE merchant_credential_ownerships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_credential_ownerships ON merchant_credential_ownerships FOR ALL TO shopai_app
  USING (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY worker_credential_ownerships_select ON merchant_credential_ownerships FOR SELECT TO shopai_worker
  USING (true);
