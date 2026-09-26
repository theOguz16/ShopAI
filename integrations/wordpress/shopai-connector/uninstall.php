<?php
/**
 * ShopAI Connector uninstall: remove plugin options and the ShopAI-created
 * WooCommerce API key. ShopAI-side connection revocation is handled from the
 * merchant dashboard.
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

global $wpdb;

$key_id = (int) get_option( 'shopai_connector_key_id', 0 );
if ( $key_id ) {
	$wpdb->delete(
		$wpdb->prefix . 'woocommerce_api_keys',
		array( 'key_id' => $key_id ),
		array( '%d' )
	);
}

delete_option( 'shopai_connector_key_id' );
delete_option( 'shopai_connector_state' );
delete_option( 'shopai_connector_api_url' );
