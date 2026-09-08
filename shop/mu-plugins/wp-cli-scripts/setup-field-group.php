<?php
/**
 * Run via `wp eval-file wp-content/mu-plugins/wp-cli-scripts/setup-field-group.php`,
 * `require`d by setup-shop.php so it shares that file's variable scope
 * (in particular `$pubquiz_categories`, set from the base64-encoded JSON
 * `wp eval-file` argument scripts/shop/setup.ts passes -- see
 * scripts/shop/lib/categories.ts). Attaches the "Advanced Product Fields
 * (Product Addons) for WooCommerce" field group to the Pubquiz product.
 * Idempotent: re-running overwrites the same field group in place.
 *
 * This directory lives under the mu-plugins mount but one level down, so
 * WordPress's must-use loader (which only scans the top level of
 * wp-content/mu-plugins/*.php) never auto-loads it.
 *
 * Ticket #72 ("three-field product page"): exactly three fields, all
 * visible -- `locale` and `difficulty` stay selects; the eight
 * `category_1`..`category_8` selects and the `mode` select are gone,
 * replaced by one `categories` field of type `checkboxes` (the free
 * tier's only multi-pick field type; there is no maximum-selection
 * setting for it -- the only `maximum` option the plugin honours is the
 * number field's `max` HTML attribute, verified against
 * includes/classes/class-html.php -- so the cap of 8 is enforced by
 * pubquiz-checkout-meta.php's own `woocommerce_add_to_cart_validation`
 * hook instead). Field ids stay `locale`/`difficulty`/`categories`
 * (matching CHECKOUT_META_KEYS's key stems) and choice slugs stay the
 * domain values (Locale/RequestedDifficulty literals, Category ids as
 * strings) -- read back by shop/mu-plugins/pubquiz-checkout-meta.php's
 * `_wapf_meta` bridge, which is what the webhook parser actually sees.
 * Field **labels** and choice **labels** are Dutch, readable text
 * (Taal/Moeilijkheid/Categorieën; Nederlands/Engels;
 * Makkelijk/Gemiddeld/Moeilijk/Gemengd; each Category's `nl` name) --
 * this plugin's free tier writes each order line item meta_data entry as
 * `$field->label => $field->value` (a *second*, customer-readable copy of
 * the pick, ignored by the webhook parser) and, separately, an internal
 * `_wapf_meta` array carrying `id`/`label`/`value`/`raw` per field (`raw`
 * is the choice's *slug*, never its label -- for `categories`, an array of
 * slugs, one per checked box, verified against
 * includes/controllers/class-product-controller.php's `to_cart_fields()`:
 * `'raw' => is_string($raw_value) ? ... : array_map('sanitize_textarea_field', $raw_value)`,
 * and checkbox inputs post `wapf[field_categories][]`, an array, per
 * views/frontend/fields/checkboxes.php) -- pubquiz-checkout-meta.php reads
 * `raw` out of that array to write the `pubquiz_*` keys the webhook parser
 * expects, so the label text customers see no longer has to double as the
 * machine-readable value.
 *
 * The `categories` field's description property is rendered by this
 * plugin's own free-tier template (`views/frontend/field-group.php` calls
 * `Html::field_description($field)`, which prints `$field->description`
 * verbatim when non-empty) -- no fallback hook was needed.
 */

if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) {
    exit;
}

if ( ! class_exists( '\\SW_WAPF\\Includes\\Classes\\Field_Groups' ) ) {
    WP_CLI::error( 'Advanced Product Fields for WooCommerce is not active.' );
}

$product = get_page_by_path( 'pubquiz', OBJECT, 'product' );
if ( ! $product ) {
    WP_CLI::error( 'Pubquiz product not found; create it before running this script.' );
}

if ( empty( $pubquiz_categories ) || ! is_array( $pubquiz_categories ) ) {
    WP_CLI::error( 'setup-field-group.php requires $pubquiz_categories (an array of ["id" => ..., "name" => ...]), set by setup-shop.php from the Supabase stack -- see scripts/shop/lib/categories.ts.' );
}

/**
 * `pricing_type` => 'none' is required, not just documentation: the
 * checkboxes template (views/frontend/fields/checkboxes.php) only skips
 * its pricing-hint span (and the `Helper::format_pricing_hint()` call that
 * reads `$option['pricing_type']`/`$option['pricing_amount']` directly,
 * with no `isset()` guard) when `$option['pricing_type'] === 'none'`;
 * leaving the key unset makes every choice trigger a PHP "Undefined array
 * key" warning per render and show a spurious "(+€0.00)" hint next to
 * every checkbox on the product page. `raw_json_to_field_group()` only
 * ever sets `$choice['pricing_type']` when the raw choice array has one
 * (includes/classes/class-field-groups.php), so it has to be supplied
 * explicitly here for every field, not just `categories` -- `select`
 * fields render through a different template that doesn't read these
 * keys, but setting them is harmless and keeps every choice consistent.
 */
function pubquiz_choice( $slug, $label, $selected = false ) {
    return [
        'slug'         => (string) $slug,
        'label'        => (string) $label,
        'selected'     => $selected ? 'true' : 'false',
        'pricing_type' => 'none',
    ];
}

$fields = [];

$fields[] = [
    'id'           => 'locale',
    'label'        => 'Taal',
    'type'         => 'select',
    'required'     => 'true',
    'conditionals' => [],
    'choices'      => [
        pubquiz_choice( 'nl', 'Nederlands', true ),
        pubquiz_choice( 'en', 'Engels' ),
    ],
];

$fields[] = [
    'id'           => 'difficulty',
    'label'        => 'Moeilijkheid',
    'type'         => 'select',
    'required'     => 'true',
    'conditionals' => [],
    'choices'      => [
        pubquiz_choice( 'easy', 'Makkelijk' ),
        pubquiz_choice( 'medium', 'Gemiddeld' ),
        pubquiz_choice( 'hard', 'Moeilijk' ),
        pubquiz_choice( 'mixed', 'Gemengd', true ),
    ],
];

$category_choices = [];
foreach ( $pubquiz_categories as $category ) {
    $category_choices[] = pubquiz_choice( (string) $category['id'], (string) $category['name'] );
}

$fields[] = [
    'id'           => 'categories',
    'label'        => 'Categorieën',
    'description'  => 'Zonder keuze krijgt elke ronde een willekeurige categorie. Kies categorieën als je ze in je quiz wilt.',
    'type'         => 'checkboxes',
    'required'     => 'false',
    'conditionals' => [],
    'choices'      => $category_choices,
];

$raw = [
    'id'     => (string) $product->ID,
    'type'   => 'product',
    'fields' => $fields,
];

$fg = \SW_WAPF\Includes\Classes\Field_Groups::raw_json_to_field_group( $raw );

update_post_meta( $product->ID, '_wapf_fieldgroup', serialize( $fg->to_array() ) );

// STDERR, not WP_CLI::success() (which writes to STDOUT): this file is now
// required by setup-shop.php (ticket #61), whose STDOUT contract allows
// exactly one closing line of JSON and nothing else.
fwrite( STDERR, "Attached the Pubquiz field group to product #{$product->ID}.\n" );
