#!/bin/sh
set -eu
: "${DATABASE_URL:?DATABASE_URL gerekli}"
: "${BACKUP_DIR:?BACKUP_DIR gerekli}"
mkdir -p "$BACKUP_DIR"
umask 077
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/shopai-$stamp.dump"
pg_dump --format=custom --no-owner --no-acl --file="$target" "$DATABASE_URL"
sha256sum "$target" > "$target.sha256"
echo "$target"
