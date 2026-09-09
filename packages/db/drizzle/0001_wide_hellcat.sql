ALTER TABLE "import_runs" ADD COLUMN "observed_at" timestamp with time zone;
UPDATE "import_runs" SET "observed_at" = "completed_at";
ALTER TABLE "import_runs" ALTER COLUMN "observed_at" SET NOT NULL;
