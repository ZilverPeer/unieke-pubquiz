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
 * Ticket #57 ("readable Dutch product options"): field ids stay
 * `locale`/`difficulty`/`mode`/`category_1`..`category_8` (matching
 * CHECKOUT_META_KEYS's key stems) and choice slugs stay the domain values
 * (Locale/RequestedDifficulty/QuizMode literals, Category ids as strings)
 * -- both read back by shop/mu-plugins/pubquiz-checkout-meta.php's
 * `_wapf_meta` bridge, which is what the webhook parser actually sees.
 * Field **labels** and choice **labels** are now Dutch, readable text
 * (Taal/Moeilijkheid/Soort quiz/Categorie N; Nederlands/Engels;
 * Makkelijk/Gemiddeld/Moeilijk/Gemengd; Gemengd/Eén categorie; each
 * Category's `nl` name) -- this plugin's free tier writes each order line
 * item meta_data entry as `$field->label => $field->value` (a *second*,
 * customer-readable copy of the pick, ignored by the webhook parser) and,
 * separately, an internal `_wapf_meta` array carrying `id`/`label`/`value`/
 * `raw` per field (`raw` is the choice's *slug*, never its label) --
 * pubquiz-checkout-meta.php reads `raw` out of that array to write the
 * `pubquiz_*` keys the webhook parser expects, so the label text customers
 * see no longer has to double as the machine-readable value (see
 * shop/README.md "Category picks" -- that limitation is gone).
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

function pubquiz_choice( $slug, $label, $selected = false ) {
    return [
        'slug'     => (string) $slug,
        'label'    => (string) $label,
        'selected' => $selected ? 'true' : 'false',
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

$fields[] = [
    'id'           => 'mode',
    'label'        => 'Soort quiz',
    'type'         => 'select',
    'required'     => 'true',
    'conditionals' => [],
    'choices'      => [
        pubquiz_choice( 'mixed', 'Gemengd', true ),
        pubquiz_choice( 'single_category', 'Eén categorie' ),
    ],
];

for ( $slot = 0; $slot < 8; $slot++ ) {
    $choices = [ pubquiz_choice( '', '(geen)', true ) ];
    foreach ( $pubquiz_categories as $category ) {
        $choices[] = pubquiz_choice( (string) $category['id'], (string) $category['name'] );
    }

    $fields[] = [
        'id'           => 'category_' . ( $slot + 1 ),
        'label'        => 'Categorie ' . ( $slot + 1 ),
        'type'         => 'select',
        'required'     => 'false',
        'conditionals' => [],
        'choices'      => $choices,
    ];
}

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
