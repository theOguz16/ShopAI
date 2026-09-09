ALTER TABLE "source_connections" ADD COLUMN "authorization_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_connections" ADD COLUMN "sync_mode" text DEFAULT 'incremental' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_connections" ADD COLUMN "sync_cursor" text;--> statement-breakpoint
ALTER TABLE "source_connections" ADD COLUMN "last_sync_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_connections" ADD COLUMN "last_successful_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_connections" ADD COLUMN "last_fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_connections" ADD COLUMN "last_sync_error" text;--> statement-breakpoint
ALTER TABLE "source_connections" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inventory" ADD COLUMN "fetched_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "fetched_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "fetched_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "variants" ADD COLUMN "fetched_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "source_connections" ADD CONSTRAINT "connection_authorization_status" CHECK ("source_connections"."authorization_status" in ('pending','active','reauthorization_required','revoked'));--> statement-breakpoint
ALTER TABLE "source_connections" ADD CONSTRAINT "connection_sync_mode" CHECK ("source_connections"."sync_mode" in ('full','incremental'));