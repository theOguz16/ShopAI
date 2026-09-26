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

$key_ids = array_merge(
	array(
		(int) get_option( 'shopai_connector_key_id', 0 ),
		(int) get_option( 'shopai_connector_candidate_key_id', 0 ),
	),
	(array) get_option( 'shopai_connector_stale_key_ids', array() )
);
foreach ( array_unique( array_map( 'intval', $key_ids ) ) as $key_id ) {
	if ( ! $key_id ) {
		continue;
	}
	$wpdb->delete(
		$wpdb->prefix . 'woocommerce_api_keys',
		array( 'key_id' => $key_id ),
		array( '%d' )
	);
}

delete_option( 'shopai_connector_key_id' );
delete_option( 'shopai_connector_candidate_key_id' );
delete_option( 'shopai_connector_stale_key_ids' );
delete_option( 'shopai_connector_state' );
delete_option( 'shopai_connector_api_url' );
