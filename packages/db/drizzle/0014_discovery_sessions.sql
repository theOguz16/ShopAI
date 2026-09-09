CREATE TABLE "discovery_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "surface" text NOT NULL,
  "transport" text NOT NULL,
  "merchant_scope" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "referrer" text,
  "campaign" text,
  "anonymous_user_id" uuid NOT NULL,
  "user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "discovery_session_transport" CHECK ("discovery_sessions"."transport" in ('rest','mcp','ucp')),
  CONSTRAINT "discovery_session_surface" CHECK ("discovery_sessions"."surface" in ('web','chatgpt','gemini','brand_widget')),
  CONSTRAINT "discovery_session_merchant_scope_array" CHECK (jsonb_typeof("discovery_sessions"."merchant_scope") = 'array')
);
--> statement-breakpoint
ALTER TABLE "discovery_sessions" ADD CONSTRAINT "discovery_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "discovery_sessions_surface_created" ON "discovery_sessions" USING btree ("surface","created_at");
--> statement-breakpoint
CREATE INDEX "discovery_sessions_anonymous_user" ON "discovery_sessions" USING btree ("anonymous_user_id","created_at");
--> statement-breakpoint
GRANT SELECT, INSERT ON discovery_sessions TO shopai_public;
--> statement-breakpoint
GRANT SELECT ON discovery_sessions TO shopai_app, shopai_worker;
--> statement-breakpoint
ALTER TABLE "search_events" ADD COLUMN "discovery_session_id" uuid;
--> statement-breakpoint
ALTER TABLE "search_events" ADD CONSTRAINT "search_events_discovery_session_id_discovery_sessions_id_fk" FOREIGN KEY ("discovery_session_id") REFERENCES "public"."discovery_sessions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "search_events_discovery_session" ON "search_events" USING btree ("discovery_session_id","occurred_at");
--> statement-breakpoint
ALTER TABLE "redirect_clicks" ADD COLUMN "discovery_session_id" uuid;
--> statement-breakpoint
ALTER TABLE "redirect_clicks" ADD CONSTRAINT "redirect_clicks_discovery_session_id_discovery_sessions_id_fk" FOREIGN KEY ("discovery_session_id") REFERENCES "public"."discovery_sessions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "redirect_clicks_discovery_session" ON "redirect_clicks" USING btree ("discovery_session_id","occurred_at");
