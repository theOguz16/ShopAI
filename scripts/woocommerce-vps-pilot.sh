#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: bash scripts/woocommerce-vps-pilot.sh <bootstrap|seed|status> /absolute/path/to/private.env" >&2
  exit 2
}

[[ $# -eq 2 ]] || usage
operation="$1"
env_file="$2"
case "$operation" in bootstrap|seed|status) ;; *) usage ;; esac
[[ "$env_file" = /* && -f "$env_file" && ! -L "$env_file" ]] || {
  echo "Provide an existing, non-symlinked absolute env-file path outside the repository." >&2
  exit 2
}

# Keep real credentials out of the repository, terminal output and world-readable files.
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
case "$(cd -- "$(dirname -- "$env_file")" && pwd)/$(basename -- "$env_file")" in
  "$repo_root"/*) echo "Private env file must be outside the repository." >&2; exit 2 ;;
esac
mode="$(stat -c %a -- "$env_file")"
if (( (8#$mode & 077) != 0 )); then
  echo "Private env file must not be accessible to group/others (chmod 600)." >&2
  exit 2
fi
command -v docker >/dev/null || { echo 'Docker is required.' >&2; exit 2; }
compose_file="$repo_root/infra/woocommerce-vps.compose.yaml"
compose() {
  docker compose --env-file "$env_file" -f "$compose_file" "$@"
}

# Validate all required variables without echoing the resolved compose (contains secrets).
compose config --quiet

case "$operation" in
  bootstrap)
    compose up -d db wordpress
    echo 'Isolated WooCommerce containers started; configure the HTTPS reverse proxy, then complete WordPress installation in the browser.'
    echo 'No ShopAI staging/production services or databases were changed.'
    ;;
  seed)
    if ! compose run --rm wpcli wp core is-installed >/dev/null; then
      echo 'Complete the browser-based WordPress installation before seeding.' >&2
      exit 1
    fi
    if compose run --rm wpcli wp plugin is-installed woocommerce >/dev/null 2>&1; then
      compose run --rm wpcli wp plugin activate woocommerce
    else
      compose run --rm wpcli wp plugin install woocommerce --version=11.1.0 --activate
    fi
    compose run --rm wpcli wp rewrite structure '/%postname%/' --hard
    compose run --rm wpcli wp rewrite flush --hard
    compose run --rm wpcli wp option update blog_public 0
    compose run --rm wpcli wp option update woocommerce_currency TRY
    compose run --rm -e SHOPAI_DEMO_SEED=1 wpcli wp eval-file /opt/shopai/seed.php
    echo 'Synthetic source is prepared; create a READ-ONLY WooCommerce REST key in the WP admin and store it only in ShopAI secret storage.'
    ;;
  status)
    compose ps
    ;;
esac
