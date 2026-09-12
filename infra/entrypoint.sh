#!/bin/sh
set -eu

case "${SHOPAI_ROLE:-}" in
  api) exec pnpm --filter @shopai/api start ;;
  worker) exec pnpm --filter @shopai/worker start ;;
  web) exec pnpm --filter @shopai/web start ;;
  widget) exec pnpm --filter @shopai/chatgpt-widget start ;;
  migrate) exec pnpm db:migrate ;;
  *) echo "SHOPAI_ROLE api, worker, web, widget veya migrate olmalıdır." >&2; exit 64 ;;
esac
