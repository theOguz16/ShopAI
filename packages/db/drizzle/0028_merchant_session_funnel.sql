CREATE OR REPLACE FUNCTION merchant_session_funnel(
  p_merchant_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE (
  sessions integer,
  searched_sessions integer,
  detail_sessions integer,
  handoff_sessions integer,
  purchased_sessions integer,
  anonymous_visitors integer,
  repeat_anonymous_visitors integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH cohort AS (
    SELECT ds.id, ds.anonymous_user_id
    FROM discovery_sessions ds
    WHERE ds.created_at >= p_from
      AND ds.created_at < p_to
      AND (
        ds.merchant_scope @> jsonb_build_array(p_merchant_id::text)
        OR EXISTS (
          SELECT 1 FROM search_events se
          WHERE se.discovery_session_id = ds.id
            AND se.merchant_id = p_merchant_id
            AND se.occurred_at >= p_from AND se.occurred_at < p_to
        )
        OR EXISTS (
          SELECT 1 FROM product_view_events pv
          WHERE pv.discovery_session_id = ds.id
            AND pv.merchant_id = p_merchant_id
            AND pv.occurred_at >= p_from AND pv.occurred_at < p_to
        )
        OR EXISTS (
          SELECT 1 FROM redirect_clicks rc
          WHERE rc.discovery_session_id = ds.id
            AND rc.merchant_id = p_merchant_id
            AND rc.occurred_at >= p_from AND rc.occurred_at < p_to
        )
        OR EXISTS (
          SELECT 1 FROM conversion_orders co
          WHERE co.discovery_session_id = ds.id
            AND co.merchant_id = p_merchant_id
            AND co.occurred_at >= p_from AND co.occurred_at < p_to
        )
      )
  ), searched AS (
    SELECT c.id, min(se.occurred_at) AS occurred_at
    FROM cohort c
    JOIN search_events se ON se.discovery_session_id = c.id
    WHERE se.merchant_id = p_merchant_id
      AND se.occurred_at >= p_from AND se.occurred_at < p_to
      AND se.request_kind = 'initial'
      AND se.intent IN ('explicit_search', 'refinement')
    GROUP BY c.id
  ), detailed AS (
    SELECT s.id, min(pv.occurred_at) AS occurred_at
    FROM searched s
    JOIN product_view_events pv ON pv.discovery_session_id = s.id
    WHERE pv.merchant_id = p_merchant_id
      AND pv.occurred_at >= s.occurred_at AND pv.occurred_at < p_to
    GROUP BY s.id
  ), handed_off AS (
    SELECT d.id, min(rc.occurred_at) AS occurred_at
    FROM detailed d
    JOIN redirect_clicks rc ON rc.discovery_session_id = d.id
    WHERE rc.merchant_id = p_merchant_id
      AND rc.classification = 'human'
      AND rc.occurred_at >= d.occurred_at AND rc.occurred_at < p_to
    GROUP BY d.id
  ), purchased AS (
    SELECT h.id
    FROM handed_off h
    JOIN conversion_orders co ON co.discovery_session_id = h.id
    WHERE co.merchant_id = p_merchant_id
      AND co.status <> 'cancelled'
      AND co.search_id IS NOT NULL
      AND co.offer_id IS NOT NULL
      AND co.occurred_at >= h.occurred_at AND co.occurred_at < p_to
    GROUP BY h.id
  ), visitor_sessions AS (
    SELECT anonymous_user_id, count(*)::integer AS session_count
    FROM cohort
    GROUP BY anonymous_user_id
  )
  SELECT
    (SELECT count(*)::integer FROM cohort),
    (SELECT count(*)::integer FROM searched),
    (SELECT count(*)::integer FROM detailed),
    (SELECT count(*)::integer FROM handed_off),
    (SELECT count(*)::integer FROM purchased),
    (SELECT count(*)::integer FROM visitor_sessions),
    (SELECT count(*)::integer FROM visitor_sessions WHERE session_count >= 2)
  WHERE p_merchant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND p_from < p_to;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION merchant_session_funnel(uuid, timestamptz, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION merchant_session_funnel(uuid, timestamptz, timestamptz) TO shopai_app;
