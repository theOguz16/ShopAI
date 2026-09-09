#!/usr/bin/env bash
set -euo pipefail

compose_file="infra/woocommerce-test.compose.yaml"
ca_file="${TMPDIR:-/tmp}/shopai-woocommerce-rehearsal-ca.crt"
readonly_key="ck_0123456789abcdef0123456789abcdef01234567"
readonly_secret="cs_0123456789abcdef0123456789abcdef01234567"
writer_key="ck_89abcdef0123456789abcdef0123456789abcdef"
writer_secret="cs_89abcdef0123456789abcdef0123456789abcdef"

docker compose -f "$compose_file" up -d db wordpress tls

for attempt in $(seq 1 60); do
  if curl --silent --show-error --insecure --fail https://localhost:18443/wp-login.php >/dev/null; then
    break
  fi
  if [[ "$attempt" == "60" ]]; then
    echo "WooCommerce prova ortamı 120 saniyede hazır olmadı." >&2
    exit 1
  fi
  sleep 2
done

wp() {
  docker compose -f "$compose_file" run --rm wpcli wp "$@"
}

if ! wp core is-installed >/dev/null 2>&1; then
  wp core install \
    --url=https://localhost:18443 \
    --title="ShopAI Sentetik WooCommerce" \
    --admin_user=rehearsal-admin \
    --admin_password=rehearsal-admin-only \
    --admin_email=rehearsal@example.invalid \
    --skip-email
fi

wp rewrite structure '/%postname%/' --hard
wp rewrite flush --hard

if ! wp plugin is-installed woocommerce; then
  wp plugin install woocommerce --version=11.1.0 --activate
else
  wp plugin activate woocommerce
fi

wp eval '
global $wpdb;
$user = get_user_by("login", "rehearsal-admin");
$keys = [
  ["ShopAI rehearsal read", "read", "ck_0123456789abcdef0123456789abcdef01234567", "cs_0123456789abcdef0123456789abcdef01234567"],
  ["ShopAI rehearsal writer", "read_write", "ck_89abcdef0123456789abcdef0123456789abcdef", "cs_89abcdef0123456789abcdef0123456789abcdef"],
];
foreach ($keys as [$description, $permissions, $key, $secret]) {
  $hash = wc_api_hash($key);
  $existing = $wpdb->get_var($wpdb->prepare("SELECT key_id FROM {$wpdb->prefix}woocommerce_api_keys WHERE consumer_key = %s", $hash));
  if (!$existing) {
    $wpdb->insert("{$wpdb->prefix}woocommerce_api_keys", [
      "user_id" => $user->ID,
      "description" => $description,
      "permissions" => $permissions,
      "consumer_key" => $hash,
      "consumer_secret" => $secret,
      "truncated_key" => substr($key, -7),
    ]);
  }
}
'

tls_container="$(docker compose -f "$compose_file" ps -q tls)"
docker cp "$tls_container:/data/caddy/pki/authorities/local/root.crt" "$ca_file"

SHOPAI_WOO_REHEARSAL=1 \
WOO_STORE_URL=https://localhost:18443 \
WOO_READ_KEY="$readonly_key" \
WOO_READ_SECRET="$readonly_secret" \
WOO_WRITE_KEY="$writer_key" \
WOO_WRITE_SECRET="$writer_secret" \
NODE_EXTRA_CA_CERTS="$ca_file" \
pnpm exec vitest run tests/woocommerce-rehearsal.test.ts

wp core version
wp plugin get woocommerce --field=version
git rev-parse HEAD
