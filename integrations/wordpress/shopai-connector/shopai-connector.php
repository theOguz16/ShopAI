<?php
/**
 * Plugin Name: ShopAI Connector
 * Description: WooCommerce mağazasını ShopAI ile güvenli, tek kullanımlık eşleştirme (pairing) akışıyla bağlar. Okuma yetkili bir WooCommerce REST API anahtarı üretir ve doğrudan ShopAI sunucusuna iletir; anahtar tarayıcıya gösterilmez.
 * Version:     1.0.0
 * Author:      ShopAI
 * License:     GPL-2.0-or-later
 * Requires PHP: 7.4
 * Text Domain: shopai-connector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'SHOPAI_CONNECTOR_VERSION', '1.0.0' );
define( 'SHOPAI_CONNECTOR_STATE_OPTION', 'shopai_connector_state' );
define( 'SHOPAI_CONNECTOR_API_URL_OPTION', 'shopai_connector_api_url' );
define( 'SHOPAI_CONNECTOR_KEY_ID_OPTION', 'shopai_connector_key_id' );
define( 'SHOPAI_CONNECTOR_CANDIDATE_KEY_ID_OPTION', 'shopai_connector_candidate_key_id' );
define( 'SHOPAI_CONNECTOR_STALE_KEY_IDS_OPTION', 'shopai_connector_stale_key_ids' );
define( 'SHOPAI_CONNECTOR_COMPLETE_PATH', '/v1/connectors/woocommerce/pairings/complete' );

/**
 * ShopAI API adresi. Eklenti içine hiçbir secret gömülmez; API adresi de
 * mağaza yöneticisi tarafından pairing talimatıyla birlikte girilir.
 */
function shopai_connector_api_url() {
	return esc_url_raw(
		(string) get_option( SHOPAI_CONNECTOR_API_URL_OPTION, '' )
	);
}

function shopai_connector_state() {
	$state = get_option( SHOPAI_CONNECTOR_STATE_OPTION, false );
	return is_array( $state ) ? $state : false;
}

/**
 * Yalnızca hassas olmayan bağlantı üst verisi saklanır; pairing token,
 * consumer key ve consumer secret hiçbir zaman option'a yazılmaz.
 */
function shopai_connector_save_state( array $state ) {
	update_option(
		SHOPAI_CONNECTOR_STATE_OPTION,
		array(
			'connectionId' => sanitize_text_field( (string) $state['connectionId'] ),
			'storeUrl'     => esc_url_raw( (string) $state['storeUrl'] ),
			'storeName'    => sanitize_text_field( (string) $state['storeName'] ),
			'mode'         => in_array( $state['mode'], array( 'connected', 'reconnected' ), true ) ? $state['mode'] : 'connected',
			'connectedAt'  => sanitize_text_field( (string) $state['connectedAt'] ),
		)
	);
}

function shopai_connector_create_api_key() {
	if ( ! function_exists( 'wc_api_hash' ) ) {
		return new WP_Error( 'shopai_woocommerce_missing', 'WooCommerce etkin değil.' );
	}

	global $wpdb;

	$consumer_key    = 'ck_' . wc_rand_hash();
	$consumer_secret = 'cs_' . wc_rand_hash();
	$user_id         = get_current_user_id();

	$wpdb->insert(
		$wpdb->prefix . 'woocommerce_api_keys',
		array(
			'description'       => 'ShopAI Connector',
			'permissions'       => 'read',
			'user_id'           => $user_id,
			'consumer_key'      => wc_api_hash( $consumer_key ),
			'truncated_key'     => substr( $consumer_key, -7 ),
			'last_access'       => null,
		),
		array( '%s', '%s', '%d', '%s', '%s', '%s' )
	);
	$key_id = (int) $wpdb->insert_id;
	if ( ! $key_id ) {
		return new WP_Error( 'shopai_key_insert_failed', 'WooCommerce API anahtarı oluşturulamadı.' );
	}
	// Track the candidate immediately so an interrupted request can clean it
	// up on the next admin action without losing the current key.
	update_option( SHOPAI_CONNECTOR_CANDIDATE_KEY_ID_OPTION, $key_id );

	return array(
		'key_id'         => $key_id,
		'consumer_key'   => $consumer_key,
		'consumer_secret' => $consumer_secret,
	);
}

function shopai_connector_delete_api_key( $key_id ) {
	global $wpdb;
	$key_id = (int) $key_id;
	if ( ! $key_id ) {
		return true;
	}
	return false !== $wpdb->delete(
			$wpdb->prefix . 'woocommerce_api_keys',
			array( 'key_id' => $key_id ),
			array( '%d' )
		);
}

function shopai_connector_cleanup_candidate() {
	$key_id = (int) get_option( SHOPAI_CONNECTOR_CANDIDATE_KEY_ID_OPTION, 0 );
	if ( $key_id && $key_id === (int) get_option( SHOPAI_CONNECTOR_KEY_ID_OPTION, 0 ) ) {
		// Recovery after a successful switch interrupted before clearing the
		// candidate marker: this is now the current key, so keep it.
		delete_option( SHOPAI_CONNECTOR_CANDIDATE_KEY_ID_OPTION );
		return;
	}
	if ( shopai_connector_delete_api_key( $key_id ) ) {
		delete_option( SHOPAI_CONNECTOR_CANDIDATE_KEY_ID_OPTION );
	}
}

function shopai_connector_cleanup_stale_keys() {
	$ids = get_option( SHOPAI_CONNECTOR_STALE_KEY_IDS_OPTION, array() );
	$remaining = array();
	foreach ( is_array( $ids ) ? $ids : array() as $id ) {
		if ( ! shopai_connector_delete_api_key( $id ) ) {
			$remaining[] = (int) $id;
		}
	}
	update_option( SHOPAI_CONNECTOR_STALE_KEY_IDS_OPTION, $remaining );
}

/**
 * Basit kaba kuvvet sınırı: kullanıcı başına 10 dakikada 5 pairing denemesi.
 */
function shopai_connector_rate_limited() {
	$user_id  = get_current_user_id();
	$transient = 'shopai_pair_attempts_' . $user_id;
	$attempts = (int) get_transient( $transient );
	if ( $attempts >= 5 ) {
		return true;
	}
	set_transient( $transient, $attempts + 1, 10 * MINUTE_IN_SECONDS );
	return false;
}

function shopai_connector_handle_connect() {
	if ( ! current_user_can( 'manage_woocommerce' ) ) {
		wp_die( esc_html__( 'Bu işlem için WooCommerce yönetici yetkisi gerekir.', 'shopai-connector' ), 403 );
	}
	check_admin_referer( 'shopai_connector_connect' );
	shopai_connector_cleanup_candidate();
	shopai_connector_cleanup_stale_keys();

	$redirect = admin_url( 'admin.php?page=shopai-connector' );

	if ( shopai_connector_rate_limited() ) {
		wp_safe_redirect( add_query_arg( 'shopai_result', 'rate_limited', $redirect ) );
		exit;
	}

	$api_url = isset( $_POST['shopai_api_url'] ) ? esc_url_raw( wp_unslash( $_POST['shopai_api_url'] ) ) : '';
	$token   = isset( $_POST['shopai_pairing_token'] ) ? sanitize_text_field( wp_unslash( $_POST['shopai_pairing_token'] ) ) : '';

	if ( ! $api_url || strpos( $api_url, 'https://' ) !== 0 ) {
		wp_safe_redirect( add_query_arg( 'shopai_result', 'invalid_api_url', $redirect ) );
		exit;
	}
	// Pairing token yalnızca bu istekte kullanılır ve hiçbir yerde saklanmaz.
	if ( ! preg_match( '/^[A-Za-z0-9_-]{43}$/', $token ) ) {
		wp_safe_redirect( add_query_arg( 'shopai_result', 'invalid_token', $redirect ) );
		exit;
	}
	$result = shopai_connector_perform_connect( $api_url, $token );
	wp_safe_redirect( add_query_arg( 'shopai_result', $result, $redirect ) );
	exit;
}
add_action( 'admin_post_shopai_connector_connect', 'shopai_connector_handle_connect' );

/** Execute the key switch without redirecting so it can be exercised in PHP. */
function shopai_connector_perform_connect( $api_url, $token ) {
	update_option( SHOPAI_CONNECTOR_API_URL_OPTION, $api_url );

	$key = shopai_connector_create_api_key();
	if ( is_wp_error( $key ) ) {
		return 'key_failed';
	}

	$payload = array(
		'siteUrl'   => home_url(),
		'siteName'  => get_bloginfo( 'name' ),
		'wpVersion' => get_bloginfo( 'version' ),
		'wooVersion' => defined( 'WC_VERSION' ) ? WC_VERSION : '',
		'credentials' => array(
			'storeUrl'       => home_url(),
			'consumerKey'    => $key['consumer_key'],
			'consumerSecret' => $key['consumer_secret'],
		),
	);

	$response = wp_remote_post(
		$api_url . SHOPAI_CONNECTOR_COMPLETE_PATH,
		array(
			'timeout' => 60,
			'headers' => array(
				'Content-Type'             => 'application/json',
				// Token URL'de değil, başlıkta taşınır.
				'x-shopai-pairing-token'   => $token,
			),
			'body'    => wp_json_encode( $payload ),
		)
	);

	$status = is_wp_error( $response )
		? 0
		: (int) wp_remote_retrieve_response_code( $response );

	if ( 200 !== $status && 201 !== $status ) {
		// Eşleşme tamamlanamadıysa üretilen anahtarı geri al; yalnızca jenerik
		// sonuç kodu göster, upstream yanıt gövdesini ekrana/loglara taşıma.
		shopai_connector_cleanup_candidate();
		$result = ( 422 === $status ) ? 'connection_failed' : ( 409 === $status ? 'conflict' : 'pairing_invalid' );
		return $result;
	}

	$body = json_decode( wp_remote_retrieve_body( $response ), true );
	if ( ! is_array( $body ) || empty( $body['connection']['id'] ) ) {
		shopai_connector_cleanup_candidate();
		return 'unexpected_response';
	}

	$old_key_id = (int) get_option( SHOPAI_CONNECTOR_KEY_ID_OPTION, 0 );
	$new_key_id = (int) $key['key_id'];
	// The candidate becomes current only after ShopAI confirms activation.
	// Keep a durable cleanup record until the previous key is deleted.
	if ( $old_key_id && $old_key_id !== $new_key_id ) {
		$stale_ids = get_option( SHOPAI_CONNECTOR_STALE_KEY_IDS_OPTION, array() );
		$stale_ids = is_array( $stale_ids ) ? $stale_ids : array();
		$stale_ids[] = $old_key_id;
		update_option( SHOPAI_CONNECTOR_STALE_KEY_IDS_OPTION, array_unique( $stale_ids ) );
	}
	update_option( SHOPAI_CONNECTOR_KEY_ID_OPTION, $new_key_id );
	delete_option( SHOPAI_CONNECTOR_CANDIDATE_KEY_ID_OPTION );
	shopai_connector_cleanup_stale_keys();
	shopai_connector_save_state(
		array(
			'connectionId' => $body['connection']['id'],
			'storeUrl'     => isset( $body['store']['url'] ) ? $body['store']['url'] : home_url(),
			'storeName'    => isset( $body['store']['name'] ) ? $body['store']['name'] : get_bloginfo( 'name' ),
			'mode'         => isset( $body['mode'] ) ? $body['mode'] : 'connected',
			'connectedAt'  => gmdate( 'c' ),
		)
	);

	return 'connected';
}

function shopai_connector_handle_disconnect_local() {
	if ( ! current_user_can( 'manage_woocommerce' ) ) {
		wp_die( esc_html__( 'Bu işlem için WooCommerce yönetici yetkisi gerekir.', 'shopai-connector' ), 403 );
	}
	check_admin_referer( 'shopai_connector_disconnect_local' );

	$redirect = admin_url( 'admin.php?page=shopai-connector' );
	$result = shopai_connector_perform_disconnect_local();
	wp_safe_redirect( add_query_arg( 'shopai_result', $result, $redirect ) );
	exit;
}
add_action( 'admin_post_shopai_connector_disconnect_local', 'shopai_connector_handle_disconnect_local' );

function shopai_connector_perform_disconnect_local() {
	shopai_connector_cleanup_candidate();
	shopai_connector_cleanup_stale_keys();
	$current_key_id = (int) get_option( SHOPAI_CONNECTOR_KEY_ID_OPTION, 0 );
	if ( shopai_connector_delete_api_key( $current_key_id ) ) {
		delete_option( SHOPAI_CONNECTOR_KEY_ID_OPTION );
		delete_option( SHOPAI_CONNECTOR_STATE_OPTION );
	}
	$stale = get_option( SHOPAI_CONNECTOR_STALE_KEY_IDS_OPTION, array() );
	return get_option( SHOPAI_CONNECTOR_KEY_ID_OPTION, 0 ) ||
		get_option( SHOPAI_CONNECTOR_CANDIDATE_KEY_ID_OPTION, 0 ) ||
		( is_array( $stale ) && count( $stale ) > 0 )
		? 'cleanup_failed' : 'local_disconnected';
}

function shopai_connector_admin_menu() {
	add_submenu_page(
		'woocommerce',
		'ShopAI Connector',
		'ShopAI Connector',
		'manage_woocommerce',
		'shopai-connector',
		'shopai_connector_render_page'
	);
}
add_action( 'admin_menu', 'shopai_connector_admin_menu' );

function shopai_connector_render_page() {
	if ( ! current_user_can( 'manage_woocommerce' ) ) {
		wp_die( esc_html__( 'Bu işlem için WooCommerce yönetici yetkisi gerekir.', 'shopai-connector' ), 403 );
	}

	$state  = shopai_connector_state();
	$result = isset( $_GET['shopai_result'] ) ? sanitize_key( wp_unslash( $_GET['shopai_result'] ) ) : '';
	$stale_ids = get_option( SHOPAI_CONNECTOR_STALE_KEY_IDS_OPTION, array() );
	$cleanup_pending = (int) get_option( SHOPAI_CONNECTOR_CANDIDATE_KEY_ID_OPTION, 0 ) > 0 ||
		( is_array( $stale_ids ) && count( $stale_ids ) > 0 );
	$messages = array(
		'connected'           => array( 'success', 'Mağaza ShopAI ile eşleştirildi.' ),
		'local_disconnected'  => array( 'success', 'Yerel API anahtarı kaldırıldı. ShopAI tarafındaki bağlantıyı panelden iptal edebilirsiniz.' ),
		'cleanup_failed'     => array( 'error', 'Yerel API anahtarı kaldırılamadı. Tekrar deneyin.' ),
		'rate_limited'        => array( 'error', 'Çok fazla deneme yapıldı. Lütfen 10 dakika sonra tekrar deneyin.' ),
		'invalid_api_url'     => array( 'error', 'ShopAI API adresi geçersiz. HTTPS adresi girin.' ),
		'invalid_token'       => array( 'error', 'Pairing kodu geçersiz.' ),
		'key_failed'          => array( 'error', 'WooCommerce API anahtarı oluşturulamadı.' ),
		'connection_failed'   => array( 'error', 'ShopAI mağaza bağlantısını doğrulayamadı. ShopAI panelden yeni pairing kodu alın ve tekrar deneyin.' ),
		'conflict'            => array( 'error', 'Bu mağaza başka bir merchant tarafından zaten bağlanmış veya çakışma var.' ),
		'pairing_invalid'     => array( 'error', 'Pairing kodu süresi dolmuş veya geçersiz. ShopAI panelden yeni kod alın.' ),
		'unexpected_response' => array( 'error', 'ShopAI beklenmeyen bir yanıt döndürdü.' ),
	);
	?>
	<div class="wrap">
		<h1>ShopAI Connector</h1>
		<?php if ( $result && isset( $messages[ $result ] ) ) : ?>
			<div class="notice notice-<?php echo esc_attr( $messages[ $result ][0] ); ?>">
				<p><?php echo esc_html( $messages[ $result ][1] ); ?></p>
			</div>
		<?php endif; ?>
		<p class="description">ShopAI panelinden bağlantıyı iptal etmek WordPress API anahtarını otomatik kaldırmaz. Buradaki yerel kaldırma işlemini ayrıca tamamlayın.</p>
		<?php if ( $cleanup_pending ) : ?>
			<div class="notice notice-warning"><p>Yerel WooCommerce API anahtarı temizliği bekliyor. Yetkili yönetici olarak yeniden bağlanın veya yerel kaldırma işlemini tekrar deneyin.</p></div>
		<?php endif; ?>

		<?php if ( $state ) : ?>
			<h2>Mevcut bağlantı</h2>
			<table class="widefat striped" style="max-width:640px">
				<tbody>
					<tr><th>Mağaza</th><td><?php echo esc_html( $state['storeName'] ); ?></td></tr>
					<tr><th>Adres</th><td><?php echo esc_html( $state['storeUrl'] ); ?></td></tr>
					<tr><th>Durum</th><td><?php echo esc_html( 'reconnected' === $state['mode'] ? 'Yeniden bağlandı' : 'Bağlı' ); ?></td></tr>
					<tr><th>Bağlantı zamanı</th><td><?php echo esc_html( $state['connectedAt'] ); ?></td></tr>
				</tbody>
			</table>
			<p>
				<a class="button" href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=shopai_connector_disconnect_local' ), 'shopai_connector_disconnect_local' ) ); ?>"
					onclick="return confirm('ShopAI tarafından oluşturulan yerel API anahtarı silinecek. Devam?');">
					Yerel API anahtarını kaldır
				</a>
			</p>
			<h2>Yeniden bağlan</h2>
			<p>ShopAI panelden yeni bir pairing kodu ürettikten sonra aşağıdaki forma girin. Mevcut bağlantı anahtarı güvenli şekilde döndürülür.</p>
		<?php else : ?>
			<h2>ShopAI ile eşleştirme</h2>
			<p>ShopAI panelden aldığınız bilgileri girin. İşlem sunucu tarafında gerçekleşir; API anahtarı tarayıcıda gösterilmez.</p>
		<?php endif; ?>

		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="max-width:640px">
			<input type="hidden" name="action" value="shopai_connector_connect" />
			<?php wp_nonce_field( 'shopai_connector_connect' ); ?>
			<table class="form-table">
				<tr>
					<th scope="row"><label for="shopai_api_url">ShopAI API adresi</label></th>
					<td>
						<input type="url" id="shopai_api_url" name="shopai_api_url" class="regular-text"
							value="<?php echo esc_attr( shopai_connector_api_url() ); ?>"
							placeholder="https://api.example.com" required />
						<p class="description">ShopAI pairing talimatında verilen API adresi.</p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="shopai_pairing_token">Pairing kodu</label></th>
					<td>
						<input type="password" id="shopai_pairing_token" name="shopai_pairing_token" class="regular-text"
							autocomplete="off" required />
						<p class="description">Tek kullanımlık, kısa ömürlü kod. ShopAI panelden alın.</p>
					</td>
				</tr>
			</table>
			<?php submit_button( 'ShopAI ile eşleştir' ); ?>
		</form>
	</div>
	<?php
}

function shopai_connector_action_links( $links ) {
	array_unshift(
		$links,
		'<a href="' . esc_url( admin_url( 'admin.php?page=shopai-connector' ) ) . '">' . esc_html__( 'Ayarlar', 'shopai-connector' ) . '</a>'
	);
	return $links;
}
add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), 'shopai_connector_action_links' );
