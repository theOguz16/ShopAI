-- Better Auth 1.7.5 built-in PostgreSQL adapter schema (CLI-generated names).
-- Additive: ShopAI UUID user/session tables and tenant memberships stay intact.
CREATE SCHEMA IF NOT EXISTS shopai_auth;
--> statement-breakpoint
REVOKE ALL ON SCHEMA shopai_auth FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA shopai_auth TO shopai_app;
--> statement-breakpoint
CREATE TABLE shopai_auth."user" (
  "id" text NOT NULL PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL,
  "image" text,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "twoFactorEnabled" boolean
);
--> statement-breakpoint
CREATE TABLE shopai_auth."session" (
  "id" text NOT NULL PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL,
  "token" text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES shopai_auth."user"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE shopai_auth."account" (
  "id" text NOT NULL PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES shopai_auth."user"("id") ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "password" text,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE shopai_auth."verification" (
  "id" text NOT NULL PRIMARY KEY,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE shopai_auth."twoFactor" (
  "id" text NOT NULL PRIMARY KEY,
  "secret" text NOT NULL,
  "backupCodes" text NOT NULL,
  "userId" text NOT NULL REFERENCES shopai_auth."user"("id") ON DELETE CASCADE,
  "verified" boolean,
  "failedVerificationCount" integer,
  "lockedUntil" timestamptz
);
--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON shopai_auth."session" ("userId");
--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON shopai_auth."account" ("userId");
--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON shopai_auth."verification" ("identifier");
--> statement-breakpoint
CREATE INDEX "twoFactor_secret_idx" ON shopai_auth."twoFactor" ("secret");
--> statement-breakpoint
CREATE INDEX "twoFactor_userId_idx" ON shopai_auth."twoFactor" ("userId");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA shopai_auth TO shopai_app;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA shopai_auth FROM shopai_public;
