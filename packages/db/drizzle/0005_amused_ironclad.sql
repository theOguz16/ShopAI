ALTER TABLE "products" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "image_alt" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "publication_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "publication_changed_by" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_publication_changed_by_users_id_fk" FOREIGN KEY ("publication_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;