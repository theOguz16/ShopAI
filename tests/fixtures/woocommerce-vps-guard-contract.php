<?php
/**
 * Contract-only WordPress shims: exercise the real ShopAI MU-plugin callbacks.
 * This is not a running WooCommerce/HTTP/hosted acceptance test.
 * Usage: php tests/fixtures/woocommerce-vps-guard-contract.php infra/woocommerce-vps-no-payments.php
 */
error_reporting(E_ALL);
ini_set('display_errors', 'stderr');
define('ABSPATH', __DIR__ . '/');
$GLOBALS['shopai_hooks'] = [];
function add_filter($name, $callback, $priority = 10, $acceptedArgs = 1)
{
    $GLOBALS['shopai_hooks'][$name][] = $callback;
}
function add_action($name, $callback, $priority = 10, $acceptedArgs = 1)
{
    add_filter($name, $callback, $priority, $acceptedArgs);
}
function __return_true() { return true; }
function __return_empty_array() { return []; }
function wc_add_notice($message, $type)
{
    throw new RuntimeException("Classic checkout denied: $type");
}
function is_checkout() { return true; }
function wp_die($message, $title, $args)
{
    throw new RuntimeException('Direct checkout denied: ' . $args['response']);
}
class WP_Error
{
    public function __construct(public string $code, public string $message, public array $data) {}
}
class ShopAI_Test_Request
{
    public function __construct(private string $method, private string $route) {}
    public function get_method() { return $this->method; }
    public function get_route() { return $this->route; }
}
function check(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}
$pluginPath = $argv[1] ?? '';
check(is_file($pluginPath), 'Pass the actual MU-plugin path.');
require $pluginPath;
$hook = static function (string $name) {
    check(count($GLOBALS['shopai_hooks'][$name] ?? []) === 1, "Missing/duplicate $name callback");
    return $GLOBALS['shopai_hooks'][$name][0];
};
check($hook('pre_wp_mail')(null) === true, 'Outgoing mail was not short-circuited.');
check($hook('woocommerce_available_payment_gateways')(['dummy' => 'gateway']) === [], 'Payment gateways were not removed.');
$rest = $hook('rest_pre_dispatch');
foreach (['/wc/store/v1/checkout', '/wc/store/v2/checkout/', '/wc/store/v1/checkout/pay'] as $route) {
    $response = $rest(null, null, new ShopAI_Test_Request('POST', $route));
    check(
        $response instanceof WP_Error
            && $response->code === 'shopai_demo_checkout_disabled'
            && ($response->data['status'] ?? null) === 403,
        "Checkout route not rejected: $route"
    );
}
foreach ([['GET', '/wc/store/v1/checkout'], ['POST', '/wc/store/v1/cart'], ['POST', '/wc/v3/products']] as [$method, $route]) {
    check($rest(null, null, new ShopAI_Test_Request($method, $route)) === null, "Unrelated route blocked: $method $route");
}
foreach (['woocommerce_checkout_process', 'template_redirect'] as $name) {
    try {
        $hook($name)();
    } catch (RuntimeException $error) {
        continue;
    }
    throw new RuntimeException("Checkout hook did not block: $name");
}
echo "ShopAI no-payment callback contract PASS\n";
