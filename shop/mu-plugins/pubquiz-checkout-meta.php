<?php
/**
 * Plugin Name: Pubquiz Checkout Meta
 * Description: Bridges the Advanced Product Fields plugin's readable,
 *              Dutch-labelled checkout choices (ticket #57, #72) back to the
 *              machine-readable `pubquiz_*` line item meta keys the webhook
 *              parser expects (CHECKOUT_META_KEYS, src/domain/checkout.ts),
 *              and enforces the 8-pick cap on the `categories` field.
 *
 * The free tier of Advanced Product Fields writes each order line item's
 * `meta_data` as `$field->label => $field->value` -- with setup-field-group.php
 * setting readable Dutch labels/choice labels (Taal/Moeilijkheid/Categorieën;
 * Nederlands/Engels; etc.), that pair is no longer the wire format the
 * webhook parser (#39) needs. The plugin separately writes a `_wapf_meta`
 * array on the same line item, keyed by field id, with one
 * `['id' => ..., 'label' => ..., 'value' => ..., 'raw' => ...]` entry per
 * field -- `raw` is the matched choice's *slug*, never its label (verified
 * against Advanced_Product_Fields_For_WooCommerce\includes\controllers\
 * class-product-controller.php's create_order_line_item(), which is exactly
 * where this hooks in, at a later priority so `_wapf_meta` already exists).
 * This plugin reads that array and adds the `pubquiz_*` keys with the
 * matching `raw` value -- CHECKOUT_META_KEYS.locale/.requestedDifficulty's
 * literal key strings for the `locale`/`difficulty` fields
 * (PUBQUIZ_CHECKOUT_META_FIELD_IDS below), and `pubquiz_category_1..N` in
 * pick order for the `categories` checkboxes field -- so the webhook parser
 * sees exactly the same keys and slug values it always has.
 *
 * `categories`' `raw` is an **array** of Category id slugs, one per checked
 * box (verified empirically against a real checkout submission:
 * `to_cart_fields()`'s `'raw' => is_string($raw_value) ?
 * sanitize_textarea_field($raw_value) : array_map('sanitize_textarea_field',
 * $raw_value)` -- checkbox inputs post `wapf[field_categories][]`, an array,
 * so `$raw_value` is never a plain string here unless nothing is checked, in
 * which case `_wapf_meta` has no `categories` entry at all:
 * `create_order_line_item()` only adds an entry when
 * `!empty($field['value'])`). `pubquiz_write_category_picks()` below writes
 * `pubquiz_category_1..N` from that array in pick order (the array's own
 * order, i.e. the customer's check order as WooCommerce received it),
 * skipping empty and duplicate ids as defence -- a checkbox group can't
 * actually produce a duplicate and an empty slug can't occur in a checked
 * box's own `value` attribute, but nothing here assumes that.
 *
 * Cap of 8: the free tier's `checkboxes` field type has no maximum-selection
 * setting (the plugin's only `maximum` option only sets the `number` field
 * type's HTML `max` attribute -- verified against
 * includes/classes/class-html.php, not enforced anywhere for `checkboxes`).
 * `pubquiz_validate_category_cap()` below hooks
 * `woocommerce_add_to_cart_validation` to reject more than 8 picks with a
 * Dutch notice before the item ever reaches the cart; 0 picks passes.
 *
 * Hides the resulting `pubquiz_*` keys from the customer-facing item meta
 * table (order view, completed-order email, My Account) and the wp-admin
 * order screen with the same two filters shop/mu-plugins/pubquiz-downloads.php
 * uses for its own raw `pubquiz_download_*` keys -- the Dutch-labelled
 * entries the plugin itself writes remain visible as the customer's order
 * summary.
 *
 * This is a must-use plugin: it ships with the wp-env setup and, unmodified,
 * with the WordPress container on the VPS later. No environment guard, same
 * as pubquiz-hold-processing.php and pubquiz-downloads.php.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * Field id => `pubquiz_*` meta key, for the two fixed single-value fields.
 * Keep these literal strings in sync with CHECKOUT_META_KEYS in
 * src/domain/checkout.ts by hand (PHP cannot import the TypeScript
 * constants module) -- pinned by src/domain/shop-fixture.test.ts. The
 * `categories` field (checkboxes, multi-value) is handled separately by
 * pubquiz_write_category_picks() below, not through this map.
 */
const PUBQUIZ_CHECKOUT_META_FIELD_IDS = array(
    'locale'     => 'pubquiz_locale',
    'difficulty' => 'pubquiz_difficulty',
);

/** Field id of the Categorieën checkboxes field (setup-field-group.php). */
const PUBQUIZ_CATEGORIES_FIELD_ID = 'categories';

/** Maximum number of Category picks accepted (spec #69/#72). */
const PUBQUIZ_MAX_CATEGORY_PICKS = 8;

/**
 * The cap notice text, shared with the browser (spec 3c, #83):
 * `pubquiz-category-dropdown.php` prints this same string into a
 * `data-pubquiz-max-picks-message` attribute so its client-side cap check
 * never has to type the message a second time. Both constants are only
 * ever read from inside a hook callback in either mu-plugin (never at
 * top-level file scope), which runs after every mu-plugin's top-level code
 * has already executed -- so the two files' alphabetical load order (this
 * one after `pubquiz-category-dropdown.php`) doesn't matter here.
 */
const PUBQUIZ_MAX_CATEGORY_PICKS_MESSAGE = 'Kies maximaal 8 categorieën.';

/**
 * Writes `pubquiz_category_1..N` from the `categories` field's `raw`
 * `_wapf_meta` value, in pick order, skipping empty and duplicate ids.
 * `$raw` is an array of Category id slugs when at least one box is checked
 * (see this file's doc comment); anything else (missing, a plain string,
 * not an array) means nothing to write.
 */
function pubquiz_write_category_picks( $item, $raw ) {
    if ( ! is_array( $raw ) ) {
        return;
    }

    $seen  = array();
    $index = 0;
    foreach ( $raw as $id ) {
        $id = is_scalar( $id ) ? (string) $id : '';
        if ( '' === $id || in_array( $id, $seen, true ) ) {
            continue;
        }
        $seen[] = $id;
        $item->add_meta_data( 'pubquiz_category_' . ( ++$index ), $id );
    }
}

/**
 * Runs after Advanced Product Fields' own `create_order_line_item` (priority
 * 20 in class-product-controller.php), so `_wapf_meta` already exists on
 * $item by the time this fires.
 */
add_action(
    'woocommerce_checkout_create_order_line_item',
    function ( $item, $cart_item_key, $values, $order ) {
        $wapf_meta = $item->get_meta( '_wapf_meta', true );
        if ( empty( $wapf_meta ) || ! is_array( $wapf_meta ) ) {
            return;
        }

        foreach ( $wapf_meta as $field_id => $entry ) {
            $raw = isset( $entry['raw'] ) ? $entry['raw'] : '';

            if ( PUBQUIZ_CATEGORIES_FIELD_ID === $field_id ) {
                pubquiz_write_category_picks( $item, $raw );
                continue;
            }

            if ( ! isset( PUBQUIZ_CHECKOUT_META_FIELD_IDS[ $field_id ] ) ) {
                continue;
            }

            if ( ! is_string( $raw ) || '' === $raw ) {
                continue;
            }

            $item->add_meta_data( PUBQUIZ_CHECKOUT_META_FIELD_IDS[ $field_id ], $raw );
        }
    },
    30,
    4
);

/**
 * Rejects an add-to-cart whose `categories` checkboxes carry more than 8
 * picks, with a Dutch notice -- the free tier's `checkboxes` field type has
 * no server-side maximum-selection enforcement (see this file's doc
 * comment). Reads straight off the raw POST data (`wapf[field_categories][]`,
 * views/frontend/fields/checkboxes.php), the same field name Advanced
 * Product Fields itself reads at add-to-cart time, so this runs regardless
 * of which product is being added (a no-op unless the Pubquiz field group's
 * own `categories` field is present in the request). 0 picks -- the field
 * absent or empty -- passes; only more than 8 is rejected.
 */
add_filter(
    'woocommerce_add_to_cart_validation',
    function ( $passed, $product_id, $quantity, $variation_id = 0, $variations = array(), $cart_item_data = array() ) {
        if ( ! $passed ) {
            return $passed;
        }

        $picks = isset( $_REQUEST['wapf']['field_' . PUBQUIZ_CATEGORIES_FIELD_ID] )
            ? $_REQUEST['wapf']['field_' . PUBQUIZ_CATEGORIES_FIELD_ID]
            : array();

        if ( ! is_array( $picks ) ) {
            return $passed;
        }

        if ( count( $picks ) > PUBQUIZ_MAX_CATEGORY_PICKS ) {
            wc_add_notice( esc_html( PUBQUIZ_MAX_CATEGORY_PICKS_MESSAGE ), 'error' );
            return false;
        }

        return $passed;
    },
    20,
    6
);

/** Every `pubquiz_*` key this plugin writes -- shared by both hiding filters below. */
function pubquiz_checkout_meta_keys() {
    $keys = array_values( PUBQUIZ_CHECKOUT_META_FIELD_IDS );
    foreach ( range( 1, PUBQUIZ_MAX_CATEGORY_PICKS ) as $slot ) {
        $keys[] = 'pubquiz_category_' . $slot;
    }
    return $keys;
}

/** Hides the raw pubquiz_* keys from the wp-admin order screen's item meta box -- same mechanism as pubquiz-downloads.php. */
add_filter(
    'woocommerce_hidden_order_itemmeta',
    function ( $hidden ) {
        return array_merge( $hidden, pubquiz_checkout_meta_keys() );
    }
);

/** Hides the raw pubquiz_* keys from the customer-facing item meta table (order view, completed-order email, My Account) -- same mechanism as pubquiz-downloads.php. */
add_filter(
    'woocommerce_order_item_get_formatted_meta_data',
    function ( $formatted_meta ) {
        $hidden = pubquiz_checkout_meta_keys();
        foreach ( $formatted_meta as $meta_id => $meta ) {
            if ( in_array( $meta->key, $hidden, true ) ) {
                unset( $formatted_meta[ $meta_id ] );
            }
        }
        return $formatted_meta;
    }
);
