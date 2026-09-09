DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shopai_app') THEN
    CREATE ROLE shopai_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shopai_worker') THEN
    CREATE ROLE shopai_worker NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shopai_public') THEN
    CREATE ROLE shopai_public NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO shopai_app, shopai_worker, shopai_public;
GRANT shopai_public TO shopai_app, shopai_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON merchants, memberships, source_connections, products, variants, offers, inventory, import_runs, users, sessions TO shopai_app, shopai_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO shopai_app, shopai_worker;
GRANT SELECT ON merchants, products, variants, offers, inventory TO shopai_public;
REVOKE ALL ON memberships, source_connections, import_runs, users, sessions FROM shopai_public;
--> statement-breakpoint
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchants FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE source_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
ALTER TABLE variants FORCE ROW LEVEL SECURITY;
ALTER TABLE offers FORCE ROW LEVEL SECURITY;
ALTER TABLE inventory FORCE ROW LEVEL SECURITY;
ALTER TABLE import_runs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_merchants ON merchants FOR ALL TO shopai_app, shopai_worker
  USING (id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_memberships ON memberships FOR ALL TO shopai_app, shopai_worker
  USING (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_connections ON source_connections FOR ALL TO shopai_app, shopai_worker
  USING (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_products ON products FOR ALL TO shopai_app, shopai_worker
  USING (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_variants ON variants FOR ALL TO shopai_app, shopai_worker
  USING (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_offers ON offers FOR ALL TO shopai_app, shopai_worker
  USING (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_inventory ON inventory FOR ALL TO shopai_app, shopai_worker
  USING (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_import_runs ON import_runs FOR ALL TO shopai_app, shopai_worker
  USING (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY public_merchants ON merchants FOR SELECT TO shopai_public USING (active = true);
CREATE POLICY public_products ON products FOR SELECT TO shopai_public USING (published = true);
CREATE POLICY public_variants ON variants FOR SELECT TO shopai_public USING (
  EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND p.merchant_id = variants.merchant_id AND p.published = true)
);
CREATE POLICY public_offers ON offers FOR SELECT TO shopai_public USING (active = true);
CREATE POLICY public_inventory ON inventory FOR SELECT TO shopai_public USING (
  EXISTS (SELECT 1 FROM offers o WHERE o.id = offer_id AND o.merchant_id = inventory.merchant_id AND o.active = true)
);
