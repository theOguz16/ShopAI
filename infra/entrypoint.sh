#!/bin/sh
set -eu

case "${SHOPAI_ROLE:-}" in
  api) exec pnpm --filter @shopai/api start ;;
  worker) exec pnpm --filter @shopai/worker start ;;
  web) exec pnpm --filter @shopai/web start ;;
  widget) exec pnpm --filter @shopai/chatgpt-widget start ;;
  migrate) exec pnpm db:migrate ;;
  staging-demo-refresh) while :; do node packages/db/dist/staging-demo-refresh.js; sleep 600; done ;;
  *) echo "SHOPAI_ROLE api, worker, web, widget, migrate veya staging-demo-refresh olmalıdır." >&2; exit 64 ;;
esac
