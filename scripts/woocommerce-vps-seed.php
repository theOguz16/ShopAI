<?php
/**
 * WP-CLI only: docker compose ... run --rm wpcli wp eval-file /opt/shopai/seed.php
 * Every generated product is explicitly synthetic; no real catalog is imported.
 */

if (!defined('WP_CLI') || !WP_CLI || getenv('SHOPAI_DEMO_SEED') !== '1') {
    exit('This fixture requires WP-CLI and SHOPAI_DEMO_SEED=1.');
}
if (!class_exists('WooCommerce') || !function_exists('imagecreatetruecolor')) {
    WP_CLI::error('Activate WooCommerce and enable PHP GD before seeding.');
}

function shopai_pilot_image(string $key, array $rgb): int
{
    $existing = get_posts([
        'post_type' => 'attachment', 'post_status' => 'inherit',
        'posts_per_page' => 1, 'fields' => 'ids',
        'meta_key' => '_shopai_pilot_image', 'meta_value' => $key,
    ]);
    if ($existing) {
        return (int) $existing[0];
    }
    $uploads = wp_upload_dir();
    if ($uploads['error']) {
        WP_CLI::error($uploads['error']);
    }
    $path = trailingslashit($uploads['path']) . 'shopai-synthetic-' . $key . '.png';
    $canvas = imagecreatetruecolor(240, 240);
    $background = imagecolorallocate($canvas, $rgb[0], $rgb[1], $rgb[2]);
    $foreground = imagecolorallocate($canvas, 255, 255, 255);
    imagefill($canvas, 0, 0, $background);
    imagestring($canvas, 5, 82, 104, 'DEMO', $foreground);
    if (!imagepng($canvas, $path)) {
        WP_CLI::error('Could not write the synthetic image.');
    }
    imagedestroy($canvas);
    $id = wp_insert_attachment([
        'post_title' => 'ShopAI SYNTHETIC ' . $key,
        'post_status' => 'inherit', 'post_mime_type' => 'image/png',
    ], $path);
    if (is_wp_error($id)) {
        WP_CLI::error($id->get_error_message());
    }
    require_once ABSPATH . 'wp-admin/includes/image.php';
    wp_update_attachment_metadata($id, wp_generate_attachment_metadata($id, $path));
    update_post_meta($id, '_shopai_pilot_image', $key);
    return (int) $id;
}

$images = [
    shopai_pilot_image('blue', [44, 91, 144]),
    shopai_pilot_image('green', [25, 112, 96]),
];
$existing = [];
foreach (get_posts([
    'post_type' => 'product', 'post_status' => 'any',
    'posts_per_page' => -1, 'fields' => 'ids',
    'meta_key' => '_shopai_pilot_fixture_id',
]) as $id) {
    $existing[(int) get_post_meta($id, '_shopai_pilot_fixture_id', true)] = (int) $id;
}

$created = 0;
$variationsCreated = 0;
for ($index = 1; $index <= 520; $index++) {
    $variable = $index <= 100;
    $sku = sprintf('SHOPAI-SYNTH-%04d', $index);
    $product = isset($existing[$index]) ? wc_get_product($existing[$index]) : false;
    if ($product && (($variable && !$product->is_type('variable')) || (!$variable && !$product->is_type('simple')))) {
        WP_CLI::error('Existing synthetic fixture has an unexpected product type: ' . $index);
    }
    if (!$product) {
        $product = $variable ? new WC_Product_Variable() : new WC_Product_Simple();
        $product->set_name('[SENTETIK DEMO] ShopAI Test Urunu ' . $index);
        $product->set_status('publish');
        $product->set_catalog_visibility('visible');
        $product->set_description($index % 21 === 0 ? '' : 'Sentetik ShopAI kabul verisi. Gercek urun veya satis degildir.');
        $product->set_short_description('SENTETIK DEMO - gercek urun degildir.');
        // Explicitly exercise missing SKU / missing image and gallery cases.
        if ($index % 26 !== 0) {
            $product->set_sku($sku);
            $product->set_image_id($images[0]);
        }
        if ($index % 6 === 0 && $index % 26 !== 0) {
            $product->set_gallery_image_ids([$images[1]]);
        }
        if ($variable) {
            $attribute = new WC_Product_Attribute();
            $attribute->set_name('Beden');
            $attribute->set_options(['S', 'M', 'L']);
            $attribute->set_visible(true);
            $attribute->set_variation(true);
            $product->set_attributes([$attribute]);
        } else {
            $product->set_regular_price((string) (300 + $index));
            if ($index % 3 === 0) {
                $product->set_sale_price((string) (270 + $index));
            }
            $product->set_manage_stock(true);
            $product->set_stock_quantity($index % 5 === 0 ? 0 : 7);
        }
        $id = $product->save();
        update_post_meta($id, '_shopai_pilot_fixture_id', $index);
        $created++;
    }
    if (!$variable) {
        continue;
    }
    // Repair an interrupted run without duplicating existing variations.
    foreach (['S', 'M', 'L'] as $sizeIndex => $size) {
        $variationSku = $sku . '-' . $size;
        if (wc_get_product_id_by_sku($variationSku)) {
            continue;
        }
        $variation = new WC_Product_Variation();
        $variation->set_parent_id($product->get_id());
        $variation->set_attributes(['Beden' => $size]);
        $variation->set_sku($variationSku);
        $variation->set_status('publish');
        $variation->set_regular_price((string) (450 + $index + $sizeIndex * 10));
        if ($index % 3 === 0) {
            $variation->set_sale_price((string) (420 + $index + $sizeIndex * 10));
        }
        $variation->set_manage_stock(true);
        $variation->set_stock_quantity($size === 'L' && $index % 4 === 0 ? 0 : 5);
        $variation->save();
        $variationsCreated++;
    }
    if ($index % 100 === 0) {
        WP_CLI::log('Processed ' . $index . ' / 520 fixture products.');
    }
}
WP_CLI::success('Synthetic fixture ready: 520 products (100 variable, 420 simple), 300 expected variations. Newly created products: ' . $created . '; newly created variations: ' . $variationsCreated . '.');
