import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const pluginUrl = new URL(
  '../integrations/wordpress/shopai-connector/shopai-connector.php',
  import.meta.url,
);

describe('ShopAI WordPress plugin (static acceptance)', () => {
  let source = '';
  it('loads the plugin source', async () => {
    source = await readFile(pluginUrl, 'utf8');
    expect(source).toContain('Plugin Name: ShopAI Connector');
  });

  it('restricts pairing and disconnect to WooCommerce admins with nonce checks', async () => {
    source ||= await readFile(pluginUrl, 'utf8');
    expect(source).toContain("current_user_can( 'manage_woocommerce' )");
    expect(source).toContain(
      "check_admin_referer( 'shopai_connector_connect' )",
    );
    expect(source).toContain(
      "check_admin_referer( 'shopai_connector_disconnect_local' )",
    );
    expect(source).toContain("'manage_woocommerce',");
  });

  it('never embeds a static ShopAI credential or API secret', async () => {
    source ||= await readFile(pluginUrl, 'utf8');
    expect(source).not.toMatch(/ck_[0-9a-f]{16,}/iu);
    expect(source).not.toMatch(/cs_[0-9a-f]{16,}/iu);
    expect(source).not.toMatch(
      /(secret|password|api[_-]?key)\s*=\s*['"][^'"]{16,}['"]/iu,
    );
    expect(source).not.toContain('Bearer ');
  });

  it('sends the pairing token in a header and credentials in the POST body, never in the URL', async () => {
    source ||= await readFile(pluginUrl, 'utf8');
    expect(source).toContain("'x-shopai-pairing-token'");
    expect(source).toContain('wp_json_encode( $payload )');
    expect(source).toContain('wp_remote_post(');
    // The complete endpoint path contains no token or credential placeholder.
    expect(source).toContain(
      "define( 'SHOPAI_CONNECTOR_COMPLETE_PATH', '/v1/connectors/woocommerce/pairings/complete' );",
    );
    expect(source).not.toMatch(/home_url\(\).*consumer/iu);
  });

  it('does not persist pairing token or raw credentials, and cleans up on failure', async () => {
    source ||= await readFile(pluginUrl, 'utf8');
    // State options only carry non-sensitive metadata; token never persists.
    expect(source).toContain('shopai_connector_state');
    expect(source).not.toMatch(/update_option\(.*pairing_token/iu);
    expect(source).not.toMatch(/update_option\(.*consumer_secret/iu);
    // On rejected pairing the generated key is deleted and only a generic
    // result code is surfaced.
    expect(source).toContain('shopai_connector_cleanup_candidate()');
    expect(source).toContain('SHOPAI_CONNECTOR_CANDIDATE_KEY_ID_OPTION');
    expect(source).toContain('SHOPAI_CONNECTOR_STALE_KEY_IDS_OPTION');
    expect(source).toContain("? 'connection_failed' :");
  });

  it('rate-limits pairing attempts per user', async () => {
    source ||= await readFile(pluginUrl, 'utf8');
    expect(source).toContain('shopai_connector_rate_limited');
    expect(source).toContain('set_transient(');
  });

  it('uninstall removes local options and the ShopAI-created key', async () => {
    const uninstall = await readFile(
      new URL(
        '../integrations/wordpress/shopai-connector/uninstall.php',
        import.meta.url,
      ),
      'utf8',
    );
    expect(uninstall).toContain('WP_UNINSTALL_PLUGIN');
    expect(uninstall).toContain('woocommerce_api_keys');
    expect(uninstall).toContain("delete_option( 'shopai_connector_state' )");
  });
});
