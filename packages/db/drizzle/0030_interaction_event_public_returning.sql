GRANT SELECT ON interaction_events TO shopai_public;
--> statement-breakpoint
DROP POLICY IF EXISTS public_interaction_events_select ON interaction_events;
--> statement-breakpoint
CREATE POLICY public_interaction_events_select ON interaction_events FOR SELECT TO shopai_public
USING (discovery_session_id = nullif(current_setting('app.discovery_session_id', true), '')::uuid);
