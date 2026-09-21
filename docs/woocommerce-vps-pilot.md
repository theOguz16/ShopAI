# TASK-018B — VPS synthetic WooCommerce source (operator runbook)

**Status: code and operator instructions only. Not deployed or externally accepted.** This is an optional, isolated source for testing ShopAI when no independent WooCommerce/Trendyol merchant is available. It does **not** turn TASK-018 real-merchant acceptance or TASK-023B real-user acceptance green. The `giyimeticaret.local` 618-product source is separate and is **not** copied to this VPS. This VPS generates 520 clearly marked synthetic products, not real items.

## Isolation and prerequisites

- Use a **separate checkout** on the existing VDS; do not replace the deployed ShopAI checkout/compose, run `docker compose down -v` against ShopAI, or use staging DB/Redis credentials here. This compose project has its own MariaDB, volumes and private DB network. WordPress HTTP is bound only to `127.0.0.1:18480` by default; the DB has **no host port**.
- Docker with Compose v2, DNS control for a test subdomain of a domain you own, and an existing host Nginx/Certbot installation are required. Check that the loopback port is unused (`sudo ss -ltnp | grep ':18480 ' || true`). Set `WOO_LOOPBACK_PORT` to another unused port if needed. Check memory/disk capacity before adding WordPress/MariaDB to the VDS.
- Do not point the DNS name to a real store. Do not import real consumer data, connect payment providers, or reuse any existing merchant credentials. A must-use WordPress plugin blocks classic checkout, Store API checkout and outgoing email; this is defense in depth, not a substitute for a real payment provider's sandbox.
- Pin/review WordPress/WooCommerce image/plugin versions before expanding beyond a short-lived rehearsal. Keep WordPress and plugins patched and restrict `/wp-admin`/`wp-login.php` by VPN/IP if possible. `blog_public=0` is a search-engine hint, **not** access control; the synthetic product pages will be publicly reachable.

## 1. Create a separate checkout and private env file

On the VDS, use a directory separate from your existing staging checkout. Example:

```bash
git clone https://github.com/theOguz16/ShopAI.git "$HOME/shopai-woo-pilot-src"
cd "$HOME/shopai-woo-pilot-src"
# Until this PR is merged: git fetch origin && git switch feat/woo-vps-synthetic-pilot
mkdir -p "$HOME/.config/shopai"
umask 077
env_file="$HOME/.config/shopai/woo-pilot.env"
test ! -e "$env_file" || { echo 'The env file already exists; do not overwrite existing DB passwords.'; exit 1; }
cat > "$env_file" <<EOF
WOO_DB_PASSWORD=$(openssl rand -hex 32)
WOO_DB_ROOT_PASSWORD=$(openssl rand -hex 32)
WOO_PUBLIC_ORIGIN=https://woo-pilot.YOUR-DOMAIN.EXAMPLE
WOO_LOOPBACK_PORT=18480
EOF
chmod 600 "$env_file"
```

Replace `woo-pilot.YOUR-DOMAIN.EXAMPLE` with a **real subdomain you control**, create its DNS A/AAAA records for the VDS, and keep the complete env file **outside Git**. Do not paste passwords/API keys into chat or PR comments. If the DB volume already exists, do not rotate these DB passwords by simply rewriting the file; coordinate a DB user-password change first.

Validate and start only the new project's containers:

```bash
bash scripts/woocommerce-vps-pilot.sh bootstrap "$HOME/.config/shopai/woo-pilot.env"
```

This deliberately does not touch Nginx, issue certificates or deploy ShopAI. If your existing Nginx already binds 80/443, **do not** start another host Caddy or bind WordPress directly to those ports.

## 2. Add an Nginx virtual host and HTTPS

Create a new server block for **only** your test subdomain in `/etc/nginx/sites-available/`, replacing the hostname with the DNS name used in `WOO_PUBLIC_ORIGIN` and the port with `WOO_LOOPBACK_PORT`:

```nginx
server {
    listen 80;
    server_name woo-pilot.YOUR-DOMAIN.EXAMPLE;
    client_max_body_size 16m;
    location / {
        proxy_pass http://127.0.0.1:18480;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable **only** that new site, run `sudo nginx -t` before `sudo systemctl reload nginx`, and use the existing Certbot Nginx workflow to obtain a valid certificate for this hostname (e.g. `sudo certbot --nginx -d woo-pilot.YOUR-DOMAIN.EXAMPLE`). Check the resulting HTTPS server block still forwards `Host` and `X-Forwarded-Proto: https`. Do not edit or replace the ShopAI `shop.fizyoflow.com` / `widget.fizyoflow.com` virtual hosts. Verify publicly from a different device/network; localhost HTTP working alone is not an internet acceptance result.

## 3. Install WordPress and generate the synthetic catalog

Open the HTTPS subdomain in your browser and complete the WordPress installation with a unique strong admin password. The setup script intentionally does not create a public admin with a hard-coded password. Then run:

```bash
cd "$HOME/shopai-woo-pilot-src"
bash scripts/woocommerce-vps-pilot.sh seed "$HOME/.config/shopai/woo-pilot.env"
bash scripts/woocommerce-vps-pilot.sh status "$HOME/.config/shopai/woo-pilot.env"
```

The seed action installs/activates the existing repository's pinned WooCommerce `11.1.0` rehearsal version, configures permalinks, disables indexing, sets TRY currency and creates **520 synthetic products** (420 simple, 100 variable with 300 variations). It includes discounts, out-of-stock cases, missing descriptions/SKUs/images, locally hosted clearly marked demo PNGs and gallery images. Fixture IDs and variation SKUs make re-running the command additive/idempotent; an interrupted run repairs missing variations. It never deletes existing products, but use this only on the **new, empty rehearsal store**.

In the WooCommerce admin, create a **read-only** REST API key for the synthetic store. Enter it through ShopAI's merchant onboarding/managed-secret workflow; do not commit it, print it in CI, or send it in chat. No real payments, purchases or conversion events are expected.

## 4. Evidence checklist — keep code, hosted, and real-world results separate

1. From outside the VDS, fetch `https://<test-domain>/wp-json/wc/store/v1/products?per_page=1` and record the actual `X-WP-Total` response header; inspect a product permalink and image URL. Confirm checkout is blocked without placing an order.
2. With the **test** WooCommerce credentials, onboard to ShopAI staging, run full sync and compare source product count/representative variant, price and stock against ShopAI's persisted catalog. Target import success >=99%, recording actual counts and release SHA rather than assuming success.
3. Change one synthetic price/stock value, run incremental sync and reconcile source against ShopAI. Test unavailable/discounted/missing-image results, signed product-page handoff and merchant dashboard's click count. A product permalink is **not** proof of cart/checkout opening.
4. Use the **actual ChatGPT host** to inspect the v4 widget card and detail image, CSP/console, variant/filter and signed external product-page navigation; preserve dated screenshot/console evidence. HTTP smoke alone is insufficient.
5. Leave real merchant credentials, actual customer conversions/GMV, Trendyol real seller acceptance and the independent 3–5 merchant / 100+ user TASK-023B **PENDING** until those external participants exist.

To stop only the separate rehearsal without deleting data: `docker compose --env-file "$HOME/.config/shopai/woo-pilot.env" -f infra/woocommerce-vps.compose.yaml stop`. Never use `down -v` to clean up a shared server without a backup and explicit review of the selected project and volumes.
