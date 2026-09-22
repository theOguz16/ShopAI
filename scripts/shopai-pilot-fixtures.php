<?php
/**
 * Deterministic WooCommerce catalog fixture for ShopAI TASK-018.
 *
 * Run from the WordPress root:
 *   wp eval-file shopai-pilot-fixtures.php
 *
 * Existing products are never deleted or modified. Re-running the script skips
 * fixture indexes that already exist and creates only missing fixture products.
 */

if (!defined('ABSPATH') || !class_exists('WooCommerce')) {
    throw new RuntimeException('WordPress and WooCommerce must be bootstrapped before running this file.');
}

const SHOPAI_PILOT_TARGET = 520;
const SHOPAI_PILOT_SIMPLE_TARGET = 420;
const SHOPAI_PILOT_TAG = 'shopai-pilot-fixture';
const SHOPAI_PILOT_META = '_shopai_pilot_fixture_index';

function shopai_pilot_log(string $message): void
{
    if (class_exists('WP_CLI')) {
        WP_CLI::log($message);
        return;
    }
    echo $message . PHP_EOL;
}

function shopai_pilot_term_id(string $taxonomy, string $name, string $slug): int
{
    $term = get_term_by('slug', $slug, $taxonomy);
    if ($term instanceof WP_Term) {
        return (int) $term->term_id;
    }
    $created = wp_insert_term($name, $taxonomy, ['slug' => $slug]);
    if (is_wp_error($created)) {
        throw new RuntimeException("Could not create {$taxonomy} {$name}: " . $created->get_error_message());
    }
    return (int) $created['term_id'];
}

function shopai_pilot_image_ids(): array
{
    $existing = get_posts([
        'post_type' => 'attachment',
        'post_status' => 'inherit',
        'posts_per_page' => -1,
        'fields' => 'ids',
        'meta_key' => '_shopai_pilot_placeholder',
        'orderby' => 'meta_value_num',
        'order' => 'ASC',
    ]);
    if (count($existing) >= 4) {
        return array_map('intval', array_slice($existing, 0, 4));
    }
    if (!function_exists('imagecreatetruecolor')) {
        throw new RuntimeException('GD is required; refusing to generate a fixture with silently missing images.');
    }
    require_once ABSPATH . 'wp-admin/includes/image.php';
    $palette = [
        ['Lacivert', 25, 45, 78],
        ['Mercan', 218, 91, 85],
        ['Zeytin', 91, 116, 82],
        ['Kum', 194, 160, 112],
    ];
    foreach ($palette as $offset => [$label, $red, $green, $blue]) {
        $image = imagecreatetruecolor(480, 480);
        $background = imagecolorallocate($image, $red, $green, $blue);
        $foreground = imagecolorallocate($image, 255, 255, 255);
        imagefilledrectangle($image, 0, 0, 479, 479, $background);
        imagestring($image, 5, 145, 220, 'ShopAI Pilot ' . ($offset + 1), $foreground);
        $filename = 'shopai-pilot-placeholder-' . ($offset + 1) . '.png';
        $upload = wp_upload_dir();
        $path = trailingslashit($upload['path']) . $filename;
        if (!imagepng($image, $path, 6)) {
            imagedestroy($image);
            throw new RuntimeException("Could not write placeholder image {$filename}.");
        }
        imagedestroy($image);
        $attachment_id = wp_insert_attachment([
            'post_mime_type' => 'image/png',
            'post_title' => "ShopAI Pilot {$label}",
            'post_status' => 'inherit',
        ], $path);
        if (is_wp_error($attachment_id) || !$attachment_id) {
            throw new RuntimeException("Could not create attachment {$filename}.");
        }
        wp_update_attachment_metadata($attachment_id, wp_generate_attachment_metadata($attachment_id, $path));
        update_post_meta($attachment_id, '_shopai_pilot_placeholder', $offset + 1);
        $existing[] = (int) $attachment_id;
    }
    return array_map('intval', array_slice($existing, 0, 4));
}

function shopai_pilot_existing_indexes(): array
{
    global $wpdb;
    $rows = $wpdb->get_results($wpdb->prepare(
        "SELECT p.ID, pm.meta_value FROM {$wpdb->posts} p INNER JOIN {$wpdb->postmeta} pm ON pm.post_id = p.ID AND pm.meta_key = %s WHERE p.post_type = 'product' AND p.post_status != 'trash'",
        SHOPAI_PILOT_META
    ));
    $indexes = [];
    foreach ($rows as $row) {
        $indexes[(int) $row->meta_value] = (int) $row->ID;
    }
    return $indexes;
}

function shopai_pilot_apply_common(WC_Product $product, int $index, array $category_ids, array $image_ids): void
{
    $adjectives = ['Anadolu', 'Boğaz', 'Kapadokya', 'Ege', 'Marmara', 'Toros', 'Pera', 'Likya', 'Safran', 'Göbeklitepe'];
    $styles = ['Günlük', 'Urban', 'Klasik', 'Aktif', 'Rahat', 'Premium', 'Minimal', 'Retro'];
    $types = ['Tişört', 'Kapüşonlu', 'Sneaker', 'Ceket', 'Şapka', 'Omuz Çantası', 'Eşofman', 'Gömlek'];
    $product->set_name(sprintf('%s %s %s %03d', $adjectives[($index - 1) % count($adjectives)], $styles[intdiv($index - 1, 10) % count($styles)], $types[($index - 1) % count($types)], $index));
    $product->set_status('publish');
    $product->set_catalog_visibility('visible');
    $product->set_category_ids([$category_ids[($index - 1) % count($category_ids)]]);
    $product->set_short_description("Yerel teknik pilot için deterministik ürün {$index}. Türkçe karakter ve katalog senaryosu kapsar.");
    $product->set_description($index <= 25 ? '' : "Dayanıklı malzeme ve günlük kullanım odağıyla hazırlanan sentetik ShopAI pilot ürünü. Fixture sıra numarası: {$index}.");
    if ($index > 20) {
        $product->set_sku(sprintf('SHOPAI-PILOT-%04d', $index));
    }
    if ($index > 20 && $image_ids) {
        $product->set_image_id($image_ids[($index - 1) % count($image_ids)]);
        if ($index <= 100) {
            $gallery = [];
            $gallery_count = 2 + ($index % 3);
            for ($position = 1; $position <= $gallery_count; $position++) {
                $gallery[] = $image_ids[($index - 1 + $position) % count($image_ids)];
            }
            $product->set_gallery_image_ids(array_values(array_unique($gallery)));
        }
    }
    $product->update_meta_data(SHOPAI_PILOT_META, $index);
}

function shopai_pilot_create_simple(int $index, array $category_ids, int $tag_id, array $image_ids): int
{
    $product = new WC_Product_Simple();
    shopai_pilot_apply_common($product, $index, $category_ids, $image_ids);
    $regular = 299 + (($index * 37) % 3700);
    $product->set_regular_price((string) $regular);
    if ($index <= 100) {
        $product->set_sale_price((string) ($regular - 50 - (($index % 4) * 25)));
    }
    $product->set_manage_stock(true);
    $product->set_stock_quantity($index <= 50 ? 0 : 3 + (($index * 7) % 48));
    $product->set_stock_status($index <= 50 ? 'outofstock' : 'instock');
    $id = $product->save();
    wp_set_object_terms($id, [$tag_id], 'product_tag');
    return $id;
}

function shopai_pilot_create_variable(int $index, array $category_ids, int $tag_id, array $image_ids): int
{
    $product = new WC_Product_Variable();
    shopai_pilot_apply_common($product, $index, $category_ids, $image_ids);
    $size_options = ['S', 'M', 'L', 'XL'];
    $color_options = ['Lacivert', 'Mercan', 'Zeytin', 'Kum'];
    $variation_count = 2 + ($index % 4);
    $sizes = array_slice($size_options, 0, min($variation_count, 4));
    $colors = array_slice($color_options, 0, min($variation_count, 4));
    $attributes = [];
    $attribute_keys = [];
    foreach ([['Beden', $sizes], ['Renk', $colors]] as [$name, $options]) {
        $attribute = new WC_Product_Attribute();
        $attribute->set_name($name);
        $attribute->set_options($options);
        $attribute->set_visible(true);
        $attribute->set_variation(true);
        $attributes[] = $attribute;
        // WooCommerce indexes custom parent attributes by this exact key.
        // Variation meta must use the same key or wc/v3 returns an empty option.
        $attribute_keys[$name] = sanitize_title($attribute->get_name());
    }
    $product->set_attributes($attributes);
    $product_id = $product->save();
    wp_set_object_terms($product_id, [$tag_id], 'product_tag');
    $base = 699 + (($index * 43) % 4300);
    for ($position = 0; $position < $variation_count; $position++) {
        $variation = new WC_Product_Variation();
        $variation->set_parent_id($product_id);
        $variation->set_attributes([
            $attribute_keys['Beden'] => $sizes[$position % count($sizes)],
            $attribute_keys['Renk'] => $colors[($position * 2 + $index) % count($colors)],
        ]);
        $regular = $base + ($position * 40);
        $variation->set_regular_price((string) $regular);
        if (($index + $position) % 5 === 0) {
            $variation->set_sale_price((string) ($regular - 75));
        }
        $variation->set_manage_stock(true);
        $out = ($position === 0 && $index <= 470);
        $variation->set_stock_quantity($out ? 0 : 2 + (($index + $position * 3) % 24));
        $variation->set_stock_status($out ? 'outofstock' : 'instock');
        if ($index > 20) {
            $variation->set_sku(sprintf('SHOPAI-PILOT-%04d-V%02d', $index, $position + 1));
        }
        $variation_id = $variation->save();
        $saved_attributes = wc_get_product_variation_attributes($variation_id);
        foreach ($variation->get_attributes() as $key => $expected) {
            $stored_key = 'attribute_' . $key;
            if (($saved_attributes[$stored_key] ?? '') !== $expected) {
                throw new RuntimeException("Variation {$variation_id} did not persist {$stored_key}={$expected}.");
            }
        }
    }
    WC_Product_Variable::sync($product_id);
    return $product_id;
}

function shopai_pilot_verify(): array
{
    global $wpdb;
    $fixture_ids = get_posts([
        'post_type' => 'product', 'post_status' => 'publish', 'posts_per_page' => -1,
        'fields' => 'ids', 'meta_key' => SHOPAI_PILOT_META,
    ]);
    $stats = [
        'total_products' => (int) wp_count_posts('product')->publish,
        'fixture_products' => count($fixture_ids),
        'simple_products' => 0,
        'variable_products' => 0,
        'variations' => 0,
        'variations_without_size' => 0,
        'in_stock_items' => 0,
        'out_of_stock_items' => 0,
        'on_sale_products' => 0,
        'without_description' => 0,
        'without_image' => 0,
        'with_gallery_images' => 0,
        'without_sku' => 0,
        'tagged_fixture_products' => 0,
        'currency' => get_woocommerce_currency(),
    ];
    foreach ($fixture_ids as $id) {
        $product = wc_get_product($id);
        if (!$product) continue;
        $stats[$product->is_type('variable') ? 'variable_products' : 'simple_products']++;
        $stats[$product->is_in_stock() ? 'in_stock_items' : 'out_of_stock_items']++;
        if ($product->is_on_sale()) $stats['on_sale_products']++;
        if (trim($product->get_description()) === '') $stats['without_description']++;
        if (!$product->get_image_id()) $stats['without_image']++;
        if (count($product->get_gallery_image_ids()) > 0) $stats['with_gallery_images']++;
        if ($product->get_sku() === '') $stats['without_sku']++;
        if (has_term(SHOPAI_PILOT_TAG, 'product_tag', $id)) $stats['tagged_fixture_products']++;
        if ($product->is_type('variable')) {
            foreach ($product->get_children() as $variation_id) {
                $variation = wc_get_product($variation_id);
                if (!$variation) continue;
                $stats['variations']++;
                $variation_attributes = wc_get_product_variation_attributes($variation_id);
                $size_key = 'attribute_' . sanitize_title('Beden');
                if (trim((string) ($variation_attributes[$size_key] ?? '')) === '') {
                    $stats['variations_without_size']++;
                }
                $stats[$variation->is_in_stock() ? 'in_stock_items' : 'out_of_stock_items']++;
            }
        }
    }
    $stats['sku_prefix_rows'] = (int) $wpdb->get_var($wpdb->prepare(
        "SELECT COUNT(*) FROM {$wpdb->postmeta} WHERE meta_key = '_sku' AND meta_value LIKE %s",
        $wpdb->esc_like('SHOPAI-PILOT-') . '%'
    ));
    return $stats;
}

if (get_woocommerce_currency() !== 'TRY') {
    update_option('woocommerce_currency', 'TRY');
    shopai_pilot_log('Store currency changed to TRY.');
} else {
    shopai_pilot_log('Store currency already TRY; no change needed.');
}

$category_names = ['T-Shirts', 'Hoodies', 'Shoes', 'Jackets', 'Accessories', 'Bags', 'Sportswear', 'Casual Wear'];
$category_ids = [];
foreach ($category_names as $name) {
    $category_ids[] = shopai_pilot_term_id('product_cat', $name, sanitize_title($name));
}
$tag_id = shopai_pilot_term_id('product_tag', 'ShopAI Pilot Fixture', SHOPAI_PILOT_TAG);
$image_ids = shopai_pilot_image_ids();
$existing = shopai_pilot_existing_indexes();
$created = 0;

for ($index = 1; $index <= SHOPAI_PILOT_TARGET; $index++) {
    if (isset($existing[$index])) continue;
    $id = $index <= SHOPAI_PILOT_SIMPLE_TARGET
        ? shopai_pilot_create_simple($index, $category_ids, $tag_id, $image_ids)
        : shopai_pilot_create_variable($index, $category_ids, $tag_id, $image_ids);
    if (!$id) throw new RuntimeException("Fixture product {$index} could not be created.");
    $created++;
    if ($created % 25 === 0) shopai_pilot_log("Created {$created} missing fixture products...");
}

shopai_pilot_log("Generation complete; created {$created}, skipped " . count($existing) . '.');
shopai_pilot_log('SHOPAI_PILOT_STATS=' . wp_json_encode(shopai_pilot_verify(), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
