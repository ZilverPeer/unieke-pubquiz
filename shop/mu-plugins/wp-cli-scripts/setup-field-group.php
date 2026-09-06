<?php
/**
 * Run via `wp eval-file wp-content/mu-plugins/wp-cli-scripts/setup-field-group.php`
 * by scripts/shop/setup.ts. Attaches the "Advanced Product Fields (Product
 * Addons) for WooCommerce" field group to the Pubquiz product, one field per
 * key in CHECKOUT_META_KEYS (src/domain/checkout.ts). Idempotent: re-running
 * overwrites the same field group in place.
 *
 * This directory lives under the mu-plugins mount but one level down, so
 * WordPress's must-use loader (which only scans the top level of
 * wp-content/mu-plugins/*.php) never auto-loads it.
 *
 * Field labels ARE the meta_data keys: this plugin's free tier writes each
 * order line item meta_data entry as `$field->label => $field->value`, so
 * whatever we set as the label is the literal key the webhook parser will
 * see. Keep the labels below in sync with CHECKOUT_META_KEYS by hand (PHP
 * cannot import the TypeScript constants module); a mismatch here is a
 * shop-setup bug, not a webhook-parser bug.
 *
 * Category choices: the plugin's free tier also formats a select field's
 * order-item-meta VALUE from the matched choice's *label*, not its slug, so
 * to guarantee the Category picks land as the exact numeric Category id
 * (never the Dutch name), each choice's label is set to the id itself. This
 * means the free checkout UI shows customers the bare id (e.g. "3") rather
 * than a category name for these dropdowns -- a known, documented UX
 * limitation of the free plugin (see shop/README.md and the ticket #37
 * report's "Interface gaps").
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

/** Category ids and Dutch names, hardcoded from supabase/seed.sql (8 seeded Categories). */
$categories = [
    1 => 'Sport',
    2 => 'Geschiedenis',
    3 => 'Muziek',
    4 => 'Aardrijkskunde',
    5 => 'Wetenschap',
    6 => 'Film en TV',
    7 => 'Literatuur',
    8 => 'Algemene Kennis',
];

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
    'label'        => 'pubquiz_locale',
    'type'         => 'select',
    'required'     => 'true',
    'conditionals' => [],
    'choices'      => [
        pubquiz_choice( 'nl', 'nl', true ),
        pubquiz_choice( 'en', 'en' ),
    ],
];

$fields[] = [
    'id'           => 'difficulty',
    'label'        => 'pubquiz_difficulty',
    'type'         => 'select',
    'required'     => 'true',
    'conditionals' => [],
    'choices'      => [
        pubquiz_choice( 'easy', 'easy' ),
        pubquiz_choice( 'medium', 'medium' ),
        pubquiz_choice( 'hard', 'hard' ),
        pubquiz_choice( 'mixed', 'mixed', true ),
    ],
];

$fields[] = [
    'id'           => 'mode',
    'label'        => 'pubquiz_mode',
    'type'         => 'select',
    'required'     => 'true',
    'conditionals' => [],
    'choices'      => [
        pubquiz_choice( 'mixed', 'mixed', true ),
        pubquiz_choice( 'single_category', 'single_category' ),
    ],
];

for ( $slot = 0; $slot < 8; $slot++ ) {
    $choices = [ pubquiz_choice( '', '(none)', true ) ];
    foreach ( $categories as $id => $name ) {
        // Label is the id, not $name -- see the file docblock.
        $choices[] = pubquiz_choice( (string) $id, (string) $id );
    }

    $fields[] = [
        'id'           => 'category_' . ( $slot + 1 ),
        'label'        => 'pubquiz_category_' . ( $slot + 1 ),
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

WP_CLI::success( "Attached the Pubquiz field group to product #{$product->ID}." );
