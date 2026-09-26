<?php
/** Executable lifecycle test with a small WordPress/WooCommerce seam. */
define( 'ABSPATH', __DIR__ );
define( 'WC_VERSION', 'test' );

$options = array();
$authorized = true;
$remote_status = 201;
$next_key_id = 1;
$issued_hash = 0;
$wpdb = new class {
	public $prefix = 'wp_';
	public $insert_id = 0;
	public $keys = array();
	public $fail_delete_once = 0;
	public function insert( $table, $values, $formats ) {
		global $next_key_id;
		$this->insert_id = $next_key_id++;
		$this->keys[ $this->insert_id ] = $values;
		return 1;
	}
	public function delete( $table, $where, $formats ) {
		if ( $this->fail_delete_once === (int) $where['key_id'] ) {
			$this->fail_delete_once = 0;
			return false;
		}
		unset( $this->keys[ (int) $where['key_id'] ] );
		return 1;
	}
};

class WP_Error {}
function add_action() {}
function add_filter() {}
function plugin_basename( $path ) { return basename( $path ); }
function get_option( $key, $default = false ) { global $options; return $options[ $key ] ?? $default; }
function update_option( $key, $value ) { global $options; $options[ $key ] = $value; return true; }
function delete_option( $key ) { global $options; unset( $options[ $key ] ); return true; }
function wc_rand_hash() { global $issued_hash; return str_pad( (string) ++$issued_hash, 32, '0', STR_PAD_LEFT ); }
function wc_api_hash( $value ) { return hash( 'sha256', $value ); }
function get_current_user_id() { return 7; }
function home_url() { return 'https://woo.example.test'; }
function get_bloginfo( $key ) { return 'test'; }
function is_wp_error( $value ) { return $value instanceof WP_Error; }
function wp_json_encode( $value ) { return json_encode( $value ); }
function wp_remote_post( $url, $args ) {
	global $remote_status;
	return array(
		'status' => $remote_status,
		'body' => json_encode( array(
			'connection' => array( 'id' => 'connection-1' ),
			'store' => array( 'url' => 'https://woo.example.test', 'name' => 'Test' ),
			'mode' => 'reconnected',
		) ),
	);
}
function wp_remote_retrieve_response_code( $response ) { return $response['status']; }
function wp_remote_retrieve_body( $response ) { return $response['body']; }
function sanitize_text_field( $value ) { return $value; }
function esc_url_raw( $value ) { return $value; }
function current_user_can( $capability ) { global $authorized; return $authorized; }
function esc_html__( $value, $domain ) { return $value; }
function wp_die( $message, $code ) { throw new RuntimeException( 'forbidden' ); }
function check_admin_referer( $action ) { return true; }

require __DIR__ . '/../../integrations/wordpress/shopai-connector/shopai-connector.php';

function check( $condition, $message ) {
	if ( ! $condition ) {
		throw new RuntimeException( $message );
	}
}
function active_key_ids() { global $wpdb; return array_keys( $wpdb->keys ); }

$url = 'https://api.example.test';
$token = str_repeat( 'A', 43 );
check( 'connected' === shopai_connector_perform_connect( $url, $token ), 'first connect failed' );
$first = (int) get_option( SHOPAI_CONNECTOR_KEY_ID_OPTION );
check( active_key_ids() === array( $first ), 'first connect must retain one key' );
update_option( SHOPAI_CONNECTOR_CANDIDATE_KEY_ID_OPTION, $first );
shopai_connector_cleanup_candidate();
check( active_key_ids() === array( $first ), 'interrupted switch recovery deleted current key' );

$remote_status = 422;
check( 'connection_failed' === shopai_connector_perform_connect( $url, $token ), 'reconnect failure not reported' );
check( active_key_ids() === array( $first ), 'failed reconnect deleted current or left candidate' );
check( $first === (int) get_option( SHOPAI_CONNECTOR_KEY_ID_OPTION ), 'failed reconnect lost current tracking' );

$remote_status = 201;
check( 'connected' === shopai_connector_perform_connect( $url, $token ), 'reconnect failed' );
$second = (int) get_option( SHOPAI_CONNECTOR_KEY_ID_OPTION );
check( $second !== $first && active_key_ids() === array( $second ), 'reconnect did not replace old key' );
check( 'connected' === shopai_connector_perform_connect( $url, $token ), 'repeated reconnect failed' );
$third = (int) get_option( SHOPAI_CONNECTOR_KEY_ID_OPTION );
check( active_key_ids() === array( $third ), 'repeated reconnect left orphan keys' );

$wpdb->fail_delete_once = $third;
check( 'connected' === shopai_connector_perform_connect( $url, $token ), 'reconnect with delayed cleanup failed' );
$fourth = (int) get_option( SHOPAI_CONNECTOR_KEY_ID_OPTION );
check( active_key_ids() === array( $third, $fourth ), 'failed old-key deletion lost track of key' );
check( in_array( $third, (array) get_option( SHOPAI_CONNECTOR_STALE_KEY_IDS_OPTION ), true ), 'stale key was not tracked' );
shopai_connector_cleanup_stale_keys();
check( active_key_ids() === array( $fourth ), 'stale key retry did not remove old key' );

$wpdb->fail_delete_once = $fourth;
check( 'cleanup_failed' === shopai_connector_perform_disconnect_local(), 'failed local cleanup was hidden' );
check( active_key_ids() === array( $fourth ), 'failed local cleanup removed tracking' );
check( 'local_disconnected' === shopai_connector_perform_disconnect_local(), 'local disconnect failed' );
check( active_key_ids() === array(), 'local disconnect left key active' );
check( 'local_disconnected' === shopai_connector_perform_disconnect_local(), 'repeated disconnect is not idempotent' );

$remote_status = 422;
check( 'connection_failed' === shopai_connector_perform_connect( $url, $token ), 'first connect failure not reported' );
check( active_key_ids() === array(), 'failed first connect left candidate key' );

$authorized = false;
try {
	shopai_connector_handle_connect();
	throw new RuntimeException( 'unauthorized user reached pairing' );
} catch ( RuntimeException $error ) {
	check( 'forbidden' === $error->getMessage(), 'unexpected authorization result' );
}
check( active_key_ids() === array(), 'unauthorized user created a key' );

echo "Woo key lifecycle: 10 scenarios passed\n";
