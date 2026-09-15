DROP POLICY public_merchants ON merchants;
--> statement-breakpoint
CREATE POLICY public_merchants ON merchants FOR SELECT TO shopai_public
  USING (active = true AND is_public = true);
--> statement-breakpoint
DROP POLICY public_products ON products;
--> statement-breakpoint
CREATE POLICY public_products ON products FOR SELECT TO shopai_public
  USING (
    published = true
    AND EXISTS (
      SELECT 1
      FROM merchants m
      WHERE m.id = products.merchant_id
        AND m.active = true
        AND m.is_public = true
    )
  );
--> statement-breakpoint
DROP POLICY public_variants ON variants;
--> statement-breakpoint
CREATE POLICY public_variants ON variants FOR SELECT TO shopai_public
  USING (
    EXISTS (
      SELECT 1
      FROM products p
      JOIN merchants m ON m.id = p.merchant_id
      WHERE p.id = variants.product_id
        AND p.merchant_id = variants.merchant_id
        AND p.published = true
        AND m.active = true
        AND m.is_public = true
    )
  );
--> statement-breakpoint
DROP POLICY public_offers ON offers;
--> statement-breakpoint
CREATE POLICY public_offers ON offers FOR SELECT TO shopai_public
  USING (
    active = true
    AND EXISTS (
      SELECT 1
      FROM variants v
      JOIN products p ON p.id = v.product_id AND p.merchant_id = v.merchant_id
      JOIN merchants m ON m.id = p.merchant_id
      WHERE v.id = offers.variant_id
        AND v.merchant_id = offers.merchant_id
        AND p.published = true
        AND m.active = true
        AND m.is_public = true
    )
  );
--> statement-breakpoint
DROP POLICY public_inventory ON inventory;
--> statement-breakpoint
CREATE POLICY public_inventory ON inventory FOR SELECT TO shopai_public
  USING (
    EXISTS (
      SELECT 1
      FROM offers o
      JOIN variants v ON v.id = o.variant_id AND v.merchant_id = o.merchant_id
      JOIN products p ON p.id = v.product_id AND p.merchant_id = v.merchant_id
      JOIN merchants m ON m.id = p.merchant_id
      WHERE o.id = inventory.offer_id
        AND o.merchant_id = inventory.merchant_id
        AND o.active = true
        AND p.published = true
        AND m.active = true
        AND m.is_public = true
    )
  );
--> statement-breakpoint
DROP POLICY public_search_events_insert ON search_events;
--> statement-breakpoint
CREATE POLICY public_search_events_insert ON search_events FOR INSERT TO shopai_public
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM merchants m
      WHERE m.id = search_events.merchant_id
        AND m.active = true
        AND m.is_public = true
    )
  );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION shopai_discovery_session_for_search(p_search_id uuid, p_merchant_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT se.discovery_session_id
  FROM search_events se
  JOIN merchants m ON m.id = se.merchant_id
  WHERE se.search_id = p_search_id
    AND se.merchant_id = p_merchant_id
    AND m.active = true
    AND m.is_public = true
  LIMIT 1
$$;
--> statement-breakpoint
ALTER TABLE discovery_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE discovery_sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY public_discovery_sessions_insert ON discovery_sessions FOR INSERT TO shopai_public
  WITH CHECK (
    id = nullif(current_setting('app.discovery_session_id', true), '')::uuid
  );
--> statement-breakpoint
CREATE POLICY public_discovery_sessions_select ON discovery_sessions FOR SELECT TO shopai_public
  USING (
    id = nullif(current_setting('app.discovery_session_id', true), '')::uuid
  );
