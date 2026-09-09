REVOKE ALL ON import_outbox_events FROM shopai_app, shopai_worker;--> statement-breakpoint
-- Keep the public role's permissive read policies from being inherited by
-- application/worker sessions. They can still SET ROLE shopai_public when a
-- deliberately public transaction is created.
ALTER ROLE shopai_app NOINHERIT;--> statement-breakpoint
ALTER ROLE shopai_worker NOINHERIT;--> statement-breakpoint
GRANT shopai_public TO shopai_app, shopai_worker WITH INHERIT FALSE, SET TRUE;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON import_outbox_events TO shopai_app;--> statement-breakpoint
GRANT SELECT, UPDATE ON import_outbox_events TO shopai_worker;--> statement-breakpoint
ALTER TABLE import_outbox_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE import_outbox_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_outbox_insert ON import_outbox_events FOR INSERT TO shopai_app
  WITH CHECK (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY tenant_outbox_select ON import_outbox_events FOR SELECT TO shopai_app
  USING (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY tenant_outbox_update ON import_outbox_events FOR UPDATE TO shopai_app
  USING (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY worker_outbox_select ON import_outbox_events FOR SELECT TO shopai_worker
  USING (true);--> statement-breakpoint
CREATE POLICY worker_outbox_update ON import_outbox_events FOR UPDATE TO shopai_worker
  USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY worker_connections_select ON source_connections FOR SELECT TO shopai_worker
  USING (true);--> statement-breakpoint
CREATE OR REPLACE FUNCTION shopai_bootstrap_merchant(
  requested_merchant_id uuid,
  requested_name text,
  requested_slug text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  requested_user_id uuid := nullif(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF requested_user_id IS NULL OR requested_name IS NULL OR btrim(requested_name) = '' THEN
    RAISE EXCEPTION 'INVALID_BOOTSTRAP_CONTEXT';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(requested_user_id::text, 0));
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = requested_user_id) THEN
    RAISE EXCEPTION 'INVALID_BOOTSTRAP_CONTEXT';
  END IF;
  IF EXISTS (SELECT 1 FROM public.memberships WHERE user_id = requested_user_id) THEN
    RAISE EXCEPTION 'SETUP_ALREADY_COMPLETED';
  END IF;
  INSERT INTO public.merchants (id, name, slug, active)
    VALUES (requested_merchant_id, btrim(requested_name), requested_slug, true);
  INSERT INTO public.memberships (merchant_id, user_id, role)
    VALUES (requested_merchant_id, requested_user_id, 'owner');
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION shopai_bootstrap_merchant(uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION shopai_bootstrap_merchant(uuid, text, text) TO shopai_app;
