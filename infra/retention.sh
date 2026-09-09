#!/bin/sh
set -eu
: "${DATABASE_URL:?DATABASE_URL gerekli}"
: "${UPLOAD_DIR:?UPLOAD_DIR gerekli}"
[ "${RETENTION_APPLY:-}" = true ] || { echo "Dry-run: RETENTION_APPLY=true verilmedi."; exit 0; }

psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 -c "select file_path from import_runs where status in ('completed','failed') and observed_at < now() - interval '7 days'" |
while IFS= read -r file_path; do
  case "$file_path" in
    "$UPLOAD_DIR"/*) rm -f -- "$file_path" ;;
    *) echo "Kapsam dışı dosya atlandı: $file_path" >&2 ;;
  esac
done

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DELETE FROM import_outbox_events WHERE run_id IN (
  SELECT id FROM import_runs WHERE status IN ('completed','failed') AND observed_at < now() - interval '7 days'
);
DELETE FROM import_runs WHERE status IN ('completed','failed') AND observed_at < now() - interval '7 days';
DELETE FROM redirect_clicks WHERE occurred_at < now() - interval '30 days';
DELETE FROM conversion_orders WHERE occurred_at < now() - interval '365 days';
DELETE FROM sessions WHERE expires_at < now() - interval '7 days';
COMMIT;
SQL
