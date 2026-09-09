CREATE TABLE "import_outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" bigint DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_outbox_events_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
ALTER TABLE "import_runs" ALTER COLUMN "completed_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "import_runs" ALTER COLUMN "completed_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "import_runs" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
UPDATE "import_runs" SET "status" = 'completed' WHERE "completed_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "import_runs" ADD COLUMN "file_path" text;--> statement-breakpoint
UPDATE "import_runs" SET "file_path" = '';--> statement-breakpoint
ALTER TABLE "import_runs" ALTER COLUMN "file_path" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "import_runs" ADD COLUMN "error" jsonb;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_merchant_id_id_unique" UNIQUE("merchant_id","id");--> statement-breakpoint
ALTER TABLE "import_outbox_events" ADD CONSTRAINT "import_outbox_events_merchant_id_run_id_import_runs_merchant_id_id_fk" FOREIGN KEY ("merchant_id","run_id") REFERENCES "public"."import_runs"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_run_status" CHECK ("import_runs"."status" in ('pending','validating','processing','completed','failed'));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON import_outbox_events TO shopai_app, shopai_worker;
