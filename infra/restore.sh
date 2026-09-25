#!/bin/sh
set -eu
: "${DATABASE_URL:?Test hedef DATABASE_URL gerekli}"
: "${BACKUP_FILE:?BACKUP_FILE gerekli}"
: "${RESTORE_TARGET:?RESTORE_TARGET=test olmalıdır}"
[ "$RESTORE_TARGET" = test ] || { echo "Yalnız test ortamına restore edilir." >&2; exit 64; }
[ "${ALLOW_RESTORE:-}" = true ] || { echo "ALLOW_RESTORE=true gerekli." >&2; exit 64; }
sha256sum -c "$BACKUP_FILE.sha256"
# Dump schema/policies reference the migration-0003 RLS roles and the owner role.
# A fresh target cluster has none of them; create them idempotently as NOLOGIN
# without passwords. Existing roles are left untouched.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shopai') THEN
    CREATE ROLE shopai NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shopai_app') THEN
    CREATE ROLE shopai_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shopai_worker') THEN
    CREATE ROLE shopai_worker NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shopai_public') THEN
    CREATE ROLE shopai_public NOLOGIN;
  END IF;
END
$$;
SQL
pg_restore --clean --if-exists --no-owner --no-acl --single-transaction --dbname="$DATABASE_URL" "$BACKUP_FILE"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "select count(*) as migration_count from drizzle.__drizzle_migrations;"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "select count(*) as public_table_count from information_schema.tables where table_schema = 'public';"
