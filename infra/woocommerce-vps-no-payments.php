<?php
/**
 * Plugin Name: ShopAI synthetic pilot guard
 * Description: Prevents checkout and email delivery on the isolated WooCommerce test source.
 */

if (!defined('ABSPATH')) {
    exit;
}

// Do not send order or account emails from a synthetic source.
add_filter('pre_wp_mail', '__return_true', PHP_INT_MAX);

// Classic WooCommerce checkout: no payment providers and no order placement.
add_filter('woocommerce_available_payment_gateways', '__return_empty_array', PHP_INT_MAX);
add_action('woocommerce_checkout_process', static function (): void {
    wc_add_notice('ShopAI sentetik test mağazasında sipariş verilemez.', 'error');
}, PHP_INT_MAX);

// Also stop direct checkout page access; product-page handoff remains testable.
add_action('template_redirect', static function (): void {
    if (function_exists('is_checkout') && is_checkout()) {
        wp_die('ShopAI sentetik test mağazasında checkout kapalıdır.', 'Test checkout disabled', ['response' => 403]);
    }
}, 1);

// WooCommerce Blocks / Store API checkout is a separate route from classic checkout.
add_filter('rest_pre_dispatch', static function ($result, $server, $request) {
    if ($request->get_method() === 'POST' && preg_match('#^/wc/store/v[0-9]+/checkout(?:/|$)#', $request->get_route())) {
        return new WP_Error('shopai_demo_checkout_disabled', 'Test mağazasında sipariş oluşturulamaz.', ['status' => 403]);
    }
    return $result;
}, 10, 3);
