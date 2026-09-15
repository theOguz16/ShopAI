#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
OPERATION="${OPERATION:-deploy}"
RELEASE_VERSION="${RELEASE_VERSION:-}"
SHOPAI_IMAGE="${SHOPAI_IMAGE:-}"
PRODUCTION_ENV_FILE="${PRODUCTION_ENV_FILE:-/etc/shopai/production.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$SCRIPT_DIR/production.compose.yaml}"
STATE_DIR="${PRODUCTION_STATE_DIR:-$SCRIPT_DIR/state}"
LOCK_FILE="${PRODUCTION_DEPLOY_LOCK_FILE:-$STATE_DIR/deploy.lock}"

fail() {
  printf 'deploy error: %s\n' "$*" >&2
  exit 1
}

for required_command in docker curl flock python3 pg_dump sha256sum; do
  command -v "$required_command" >/dev/null 2>&1 ||
    fail "gerekli command bulunamadı: $required_command"
done

[[ "$OPERATION" == "deploy" || "$OPERATION" == "rollback" ]] || fail 'OPERATION deploy veya rollback olmalıdır'
[[ "$RELEASE_VERSION" =~ ^[0-9a-f]{40}$ ]] || fail 'RELEASE_VERSION 40 karakter immutable commit SHA olmalıdır'
[[ "$SHOPAI_IMAGE" =~ ^[a-z0-9./:_-]+$ ]] || fail 'SHOPAI_IMAGE geçersiz'
[[ -f "$PRODUCTION_ENV_FILE" ]] || fail "production env dosyası bulunamadı: $PRODUCTION_ENV_FILE"
[[ -f "$COMPOSE_FILE" ]] || fail "compose dosyası bulunamadı: $COMPOSE_FILE"
[[ -x "$SCRIPT_DIR/backup.sh" ]] || fail 'backup.sh executable olmalıdır'

if find "$PRODUCTION_ENV_FILE" -perm /077 -print -quit | grep -q .; then
  fail 'production env dosyası group/world erişimine açık olmamalıdır (chmod 600)'
fi

read_env_value() {
  python3 - "$PRODUCTION_ENV_FILE" "$1" <<'PY'
import sys

path, key = sys.argv[1], sys.argv[2]
with open(path, encoding='utf-8') as handle:
    for raw in handle:
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('export '):
            line = line[7:].lstrip()
        if '=' not in line:
            continue
        current_key, value = line.split('=', 1)
        if current_key.strip() != key:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        sys.stdout.write(value)
        raise SystemExit(0)
raise SystemExit(3)
PY
}

mkdir -p "$STATE_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || fail 'başka bir production deploy/rollback çalışıyor'

if ! PRODUCTION_DATABASE_URL="$(read_env_value PRODUCTION_DATABASE_URL)"; then
  fail 'PRODUCTION_DATABASE_URL production env dosyasında bulunamadı'
fi
PRODUCTION_BACKUP_DIR="$(read_env_value PRODUCTION_BACKUP_DIR || true)"
PRODUCTION_BACKUP_DIR="${PRODUCTION_BACKUP_DIR:-/var/backups/shopai-production}"

CURRENT_RELEASE_FILE="$STATE_DIR/current-release"
PREVIOUS_RELEASE_FILE="$STATE_DIR/previous-release"
CURRENT_RELEASE=""
if [[ -f "$CURRENT_RELEASE_FILE" ]]; then
  CURRENT_RELEASE="$(tr -d '[:space:]' < "$CURRENT_RELEASE_FILE")"
  [[ -z "$CURRENT_RELEASE" || "$CURRENT_RELEASE" =~ ^[0-9a-f]{40}$ ]] || fail 'current-release state geçersiz'
fi

if [[ "$OPERATION" == "rollback" && "$CURRENT_RELEASE" == "$RELEASE_VERSION" ]]; then
  printf 'release %s zaten aktif; rollback gerekmiyor\n' "$RELEASE_VERSION"
  exit 0
fi

export RELEASE_VERSION SHOPAI_IMAGE

docker network inspect shopai-production-net >/dev/null 2>&1 || \
  docker network create shopai-production-net >/dev/null

docker compose --env-file "$PRODUCTION_ENV_FILE" -f "$COMPOSE_FILE" config >/dev/null

docker pull "$SHOPAI_IMAGE:$RELEASE_VERSION" >/dev/null

if [[ "$OPERATION" == "deploy" ]]; then
  mkdir -p "$PRODUCTION_BACKUP_DIR"
  DATABASE_URL="$PRODUCTION_DATABASE_URL" \
    BACKUP_DIR="$PRODUCTION_BACKUP_DIR" \
    "$SCRIPT_DIR/backup.sh"

  docker compose \
    --env-file "$PRODUCTION_ENV_FILE" \
    -f "$COMPOSE_FILE" \
    --profile migration \
    run --rm migrate
fi

docker compose \
  --env-file "$PRODUCTION_ENV_FILE" \
  -f "$COMPOSE_FILE" \
  up -d --remove-orphans api worker web widget

verify_release() {
  local attempt response
  for attempt in $(seq 1 30); do
    if response="$(curl -fsS --max-time 5 http://127.0.0.1:5400/health/ready 2>/dev/null)"; then
      if [[ "$response" == *"\"status\":\"ok\""* && "$response" == *"\"release\":\"$RELEASE_VERSION\""* ]]; then
        curl -fsS --max-time 5 http://127.0.0.1:5500/health/ready >/dev/null
        curl -fsS --max-time 5 http://127.0.0.1:5300/ >/dev/null
        return 0
      fi
    fi
    sleep 2
  done
  return 1
}

if ! verify_release; then
  printf 'release doğrulaması başarısız: %s\n' "$RELEASE_VERSION" >&2
  if [[ -n "$CURRENT_RELEASE" ]]; then
    printf 'önceki application release: %s\n' "$CURRENT_RELEASE" >&2
    printf 'explicit rollback çalıştır: OPERATION=rollback RELEASE_VERSION=%s ... ./deploy-release.sh\n' "$CURRENT_RELEASE" >&2
  fi
  exit 1
fi

if [[ -n "$CURRENT_RELEASE" && "$CURRENT_RELEASE" != "$RELEASE_VERSION" ]]; then
  printf '%s\n' "$CURRENT_RELEASE" > "$PREVIOUS_RELEASE_FILE.tmp"
  mv "$PREVIOUS_RELEASE_FILE.tmp" "$PREVIOUS_RELEASE_FILE"
fi
printf '%s\n' "$RELEASE_VERSION" > "$CURRENT_RELEASE_FILE.tmp"
mv "$CURRENT_RELEASE_FILE.tmp" "$CURRENT_RELEASE_FILE"

printf '%s success: %s\n' "$OPERATION" "$RELEASE_VERSION"
