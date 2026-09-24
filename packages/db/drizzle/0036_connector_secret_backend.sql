ALTER TABLE connector_secrets ADD COLUMN backend text NOT NULL DEFAULT 'file';
--> statement-breakpoint
ALTER TABLE connector_secrets ADD CONSTRAINT connector_secret_backend CHECK (backend IN ('file','aws'));
