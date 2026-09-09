#!/bin/sh
set -eu
: "${DATABASE_URL:?Test hedef DATABASE_URL gerekli}"
: "${BACKUP_FILE:?BACKUP_FILE gerekli}"
: "${RESTORE_TARGET:?RESTORE_TARGET=test olmalıdır}"
[ "$RESTORE_TARGET" = test ] || { echo "Yalnız test ortamına restore edilir." >&2; exit 64; }
[ "${ALLOW_RESTORE:-}" = true ] || { echo "ALLOW_RESTORE=true gerekli." >&2; exit 64; }
sha256sum --check "$BACKUP_FILE.sha256"
pg_restore --clean --if-exists --no-owner --no-acl --single-transaction --dbname="$DATABASE_URL" "$BACKUP_FILE"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "select count(*) as migration_count from drizzle.__drizzle_migrations;"
