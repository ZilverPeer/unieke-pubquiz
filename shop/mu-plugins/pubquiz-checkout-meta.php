<?php
/**
 * Plugin Name: Pubquiz Checkout Meta
 * Description: Bridges the Advanced Product Fields plugin's readable,
 *              Dutch-labelled checkout choices (ticket #57) back to the
 *              machine-readable `pubquiz_*` line item meta keys the webhook
 *              parser expects (CHECKOUT_META_KEYS, src/domain/checkout.ts).
 *
 * The free tier of Advanced Product Fields writes each order line item's
 * `meta_data` as `$field->label => $field->value` -- with setup-field-group.php
 * now setting readable Dutch labels/choice labels (Taal/Moeilijkheid/Soort
 * quiz/Categorie N; Nederlands/Engels; etc.), that pair is no longer the
 * wire format the webhook parser (#39) needs. The plugin separately writes
 * a `_wapf_meta` array on the same line item, keyed by field id, with one
 * `['id' => ..., 'label' => ..., 'value' => ..., 'raw' => ...]` entry per
 * field -- `raw` is the matched choice's *slug*, never its label (verified
 * against Advanced_Product_Fields_For_WooCommerce\includes\controllers\
 * class-product-controller.php's create_order_line_item(), which is exactly
 * where this hooks in, at a later priority so `_wapf_meta` already exists).
 * This plugin reads that array and adds the four `pubquiz_*` keys with the
 * matching `raw` value -- CHECKOUT_META_KEYS.locale/.requestedDifficulty/
 * .quizMode/.categoryPick(slot)'s literal key strings, one entry per field
 * id in PUBQUIZ_CHECKOUT_META_FIELD_IDS below -- so the webhook parser sees
 * exactly the same keys and slug values it always has.
 *
 * A Category slot left at "(geen)" has an empty `raw` (the choice's slug is
 * `''`) -- skipped here, same as today's behaviour for an unfilled slot
 * (place-order.ts and the field group before this ticket never wrote a
 * `pubquiz_category_N` key for an unfilled slot either).
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
 * Field id => `pubquiz_*` meta key, for the three fixed fields. Keep these
 * literal strings in sync with CHECKOUT_META_KEYS in src/domain/checkout.ts
 * by hand (PHP cannot import the TypeScript constants module) -- pinned by
 * src/domain/shop-fixture.test.ts.
 */
const PUBQUIZ_CHECKOUT_META_FIELD_IDS = array(
    'locale'     => 'pubquiz_locale',
    'difficulty' => 'pubquiz_difficulty',
    'mode'       => 'pubquiz_mode',
);

/** Matches a field id key ("category_N", 1-based per CHECKOUT_META_KEYS.categoryPick). */
const PUBQUIZ_CHECKOUT_META_CATEGORY_FIELD_ID_PATTERN = '/^category_(\d+)$/';

/** Resolves a field id (e.g. "locale", "category_3") to its `pubquiz_*` meta key, or null if the field id isn't one of ours. */
function pubquiz_checkout_meta_key_for_field_id( $field_id ) {
    if ( isset( PUBQUIZ_CHECKOUT_META_FIELD_IDS[ $field_id ] ) ) {
        return PUBQUIZ_CHECKOUT_META_FIELD_IDS[ $field_id ];
    }
    if ( preg_match( PUBQUIZ_CHECKOUT_META_CATEGORY_FIELD_ID_PATTERN, $field_id, $captured ) ) {
        return 'pubquiz_category_' . $captured[1];
    }
    return null;
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
            $meta_key = pubquiz_checkout_meta_key_for_field_id( (string) $field_id );
            if ( null === $meta_key ) {
                continue;
            }

            $raw = isset( $entry['raw'] ) ? $entry['raw'] : '';
            if ( ! is_string( $raw ) || '' === $raw ) {
                continue; // Unfilled Category slot ("(geen)") -- same as today's skip.
            }

            $item->add_meta_data( $meta_key, $raw );
        }
    },
    30,
    4
);

/** Every `pubquiz_*` key this plugin writes -- shared by both hiding filters below. */
function pubquiz_checkout_meta_keys() {
    $keys = array_values( PUBQUIZ_CHECKOUT_META_FIELD_IDS );
    foreach ( range( 1, 8 ) as $slot ) {
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
