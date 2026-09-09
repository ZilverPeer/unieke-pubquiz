<?php
/**
 * Plugin Name: Pubquiz Checkout Feasibility
 * Description: Asks the app's feasibility endpoint, at checkout validation,
 *              whether every Pubquiz cart line can actually be generated for
 *              the billing email being used -- before payment, so a
 *              shortfall is a plain-Dutch checkout notice instead of a
 *              post-payment refund (spec 5, #98, ticket #103).
 *
 * Hook: `woocommerce_after_checkout_validation` (fires once the billing
 * email is known, on the *posted* checkout data -- the order does not exist
 * yet, so this reads the cart, not order line items). Runs only when the
 * cart holds at least one Pubquiz-configured line (matched the same way
 * pubquiz-hold-processing.php matches an order line: presence of the
 * `locale` field, here on the cart item's own `wapf` array rather than the
 * `_wapf_meta` order line meta that array becomes at order creation --
 * `pubquiz-checkout-meta.php`'s doc comment and
 * class-product-controller.php's `create_order_line_item()` confirm the
 * cart item's `wapf` entries and the order line's `_wapf_meta` entries carry
 * the same `id`/`raw` shape, just at two different times in the same
 * checkout) and the posted billing email is non-empty.
 *
 * Signing and endpoint: reuses the shop's own `order.updated` WooCommerce
 * webhook record (`pubquiz_feasibility_find_webhook()` below, the same
 * `WC_Data_Store::load('webhook')` lookup `setup-shop.php` uses) rather than
 * a new option or environment variable -- its delivery URL
 * (`http://host.docker.internal:3000/api/webhooks/woocommerce` locally) has
 * `/api/webhooks/woocommerce` replaced with `/api/feasibility`, and its
 * secret signs the request the same way
 * (`X-Pubquiz-Signature: base64(hmac-sha256(rawBody, secret))`, see
 * `src/app/api/feasibility/README.md` "Signature"). No webhook found, a
 * timeout, a non-200, a non-JSON body, or a `lines` array of the wrong
 * length is fail-open: one `wc_get_logger()` warning (source
 * `pubquiz-feasibility`) and checkout proceeds untouched -- never a secret,
 * never a billing email, in that log line.
 *
 * Category and Difficulty labels for the Dutch notice come from the
 * product's own Advanced Product Fields field group (the same one
 * `setup-field-group.php` attaches and `pubquiz-category-dropdown.php`
 * reads client-side) via the plugin's public
 * `Field_Groups::get_field_groups_of_product()` -- the Category id is the
 * choice `slug`, its Dutch name the choice `label`, same for Difficulty
 * (easy/medium/hard/mixed -> Makkelijk/Gemiddeld/Moeilijk/Gemengd). All
 * notice strings live in this file (shop-side Dutch, per #98's
 * "Implementation Decisions").
 *
 * Pure parts are kept as plain functions with a `pubquiz_feasibility_`
 * prefix (build the request lines from the cart, format one line's notice
 * from the response plus the label maps) so a later ticket can unit-test
 * them without a PHP test runner in this repo yet (#83's decision, restated
 * for this ticket).
 *
 * This is a must-use plugin: it ships with the wp-env setup and,
 * unmodified, with the WordPress container on the VPS later. No environment
 * guard -- the feasibility check is meant to run in production too, same as
 * `pubquiz-hold-processing.php` and `pubquiz-allow-host-webhooks.php`.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/** Field ids of the three Advanced Product Fields on the Pubquiz product (setup-field-group.php). Literal copies, same as pubquiz-category-dropdown.php's own -- PHP has no shared constants file across mu-plugins here. */
const PUBQUIZ_FEASIBILITY_LOCALE_FIELD_ID      = 'locale';
const PUBQUIZ_FEASIBILITY_DIFFICULTY_FIELD_ID  = 'difficulty';
const PUBQUIZ_FEASIBILITY_CATEGORIES_FIELD_ID  = 'categories';

/** WooCommerce webhook topic whose delivery URL/secret this plugin reuses (setup-shop.php's PUBQUIZ_WEBHOOK_TOPIC). */
const PUBQUIZ_FEASIBILITY_WEBHOOK_TOPIC = 'order.updated';

/** Path of the shop-side webhook receiver; replaced with PUBQUIZ_FEASIBILITY_ENDPOINT_PATH to get the feasibility URL from the same delivery URL. */
const PUBQUIZ_FEASIBILITY_WEBHOOK_PATH  = '/api/webhooks/woocommerce';
const PUBQUIZ_FEASIBILITY_ENDPOINT_PATH = '/api/feasibility';

/** wp_remote_post's timeout budget (spec 5, #98 story 10: "checkout never hangs"). */
const PUBQUIZ_FEASIBILITY_TIMEOUT_SECONDS = 3;

const PUBQUIZ_FEASIBILITY_SIGNATURE_HEADER = 'X-Pubquiz-Signature';
const PUBQUIZ_FEASIBILITY_LOG_SOURCE       = 'pubquiz-feasibility';

/**
 * One cart item's `wapf` field entry, or null if that field id isn't
 * present (an empty field value never reaches `wapf` at all --
 * class-product-controller.php's `add_fields_to_cart_item()` skips `''`).
 * Pure: takes the cart item's own array, no WordPress call.
 */
function pubquiz_feasibility_wapf_field( array $cart_item, string $field_id ) {
    if ( empty( $cart_item['wapf'] ) || ! is_array( $cart_item['wapf'] ) ) {
        return null;
    }
    foreach ( $cart_item['wapf'] as $field ) {
        if ( isset( $field['id'] ) && $field_id === $field['id'] ) {
            return $field;
        }
    }
    return null;
}

/**
 * One cart item's Category picks, in the customer's own check order --
 * `raw` is an array of Category id slugs when at least one box is checked,
 * absent (not an array) otherwise. Skips empty/duplicate ids as defence,
 * mirroring `pubquiz_write_category_picks()` in pubquiz-checkout-meta.php.
 */
function pubquiz_feasibility_category_picks( array $cart_item ) {
    $field = pubquiz_feasibility_wapf_field( $cart_item, PUBQUIZ_FEASIBILITY_CATEGORIES_FIELD_ID );
    $raw   = ( $field && isset( $field['raw'] ) ) ? $field['raw'] : null;
    if ( ! is_array( $raw ) ) {
        return [];
    }

    $picks = [];
    foreach ( $raw as $id ) {
        $id = is_scalar( $id ) ? (string) $id : '';
        if ( '' === $id || in_array( $id, $picks, true ) ) {
            continue;
        }
        $picks[] = $id;
    }
    return $picks;
}

/**
 * Builds one feasibility request line from a cart item, or null if the item
 * carries no Pubquiz `locale` field (not a Pubquiz line -- mirrors
 * pubquiz-hold-processing.php's presence check, on the cart item's `wapf`
 * array instead of the order line's `_wapf_meta`). A cart item with
 * quantity above 1 is still one line: quantity is never read here.
 */
function pubquiz_feasibility_line_from_cart_item( array $cart_item ) {
    $locale_field = pubquiz_feasibility_wapf_field( $cart_item, PUBQUIZ_FEASIBILITY_LOCALE_FIELD_ID );
    if ( ! $locale_field || empty( $locale_field['raw'] ) || ! is_string( $locale_field['raw'] ) ) {
        return null;
    }

    $difficulty_field = pubquiz_feasibility_wapf_field( $cart_item, PUBQUIZ_FEASIBILITY_DIFFICULTY_FIELD_ID );
    // An empty/missing Difficulty is skipped, same as a missing locale
    // above, rather than sent as '': the endpoint's shape validation
    // rejects an unknown/empty requestedDifficulty with a 400 for the
    // *whole* request, which would fail every line open, not just this one.
    if ( ! $difficulty_field || empty( $difficulty_field['raw'] ) || ! is_string( $difficulty_field['raw'] ) ) {
        return null;
    }

    return [
        'locale'             => $locale_field['raw'],
        'requestedDifficulty' => $difficulty_field['raw'],
        'categoryPicks'      => pubquiz_feasibility_category_picks( $cart_item ),
    ];
}

/**
 * All feasibility lines for the given cart, cart order, skipping any cart
 * item that isn't a Pubquiz line. Pure: `$cart_items` is a plain array of
 * cart item arrays (e.g. `WC()->cart->get_cart()`), no WordPress call.
 */
function pubquiz_feasibility_build_lines( array $cart_items ) {
    $lines = [];
    foreach ( $cart_items as $cart_item ) {
        $line = pubquiz_feasibility_line_from_cart_item( $cart_item );
        if ( null !== $line ) {
            $lines[] = $line;
        }
    }
    return $lines;
}

/** The request body array (not yet JSON-encoded) for the given billing email and lines. Pure. */
function pubquiz_feasibility_request_body( string $billing_email, array $lines ) {
    return [
        'billingEmail' => $billing_email,
        'lines'        => $lines,
    ];
}

/** `X-Pubquiz-Signature`'s value: base64(hmac-sha256(rawBody, secret)), binary digest then base64 -- same scheme as the webhook route. Pure. */
function pubquiz_feasibility_sign( string $raw_body, string $secret ) {
    return base64_encode( hash_hmac( 'sha256', $raw_body, $secret, true ) );
}

/** The feasibility endpoint URL for a given webhook delivery URL. Pure string replace. */
function pubquiz_feasibility_endpoint_url( string $delivery_url ) {
    return str_replace( PUBQUIZ_FEASIBILITY_WEBHOOK_PATH, PUBQUIZ_FEASIBILITY_ENDPOINT_PATH, $delivery_url );
}

/**
 * Groups a line's raw per-slot shortfalls by (categoryId, requestedDifficulty)
 * -- the dry run reports one entry per short *slot*, not per Category
 * (`@/sample`'s `dryRunRequest`: "every slot ... that would fall short",
 * `src/sample/README.md`), and a single Category pick cycled onto all 8
 * slots shares one Item pool, so several slots run out for the exact same
 * reason. Keeps the maximum `shortfall` seen per group (the group's slots
 * all draw from the same pool, so the worst-off slot is the group's true
 * shortfall) and returns groups in first-seen order. Pure.
 */
function pubquiz_feasibility_group_shortfalls( array $shortfalls ) {
    $groups = [];
    foreach ( $shortfalls as $shortfall ) {
        $category_id = isset( $shortfall['categoryId'] ) ? (string) $shortfall['categoryId'] : '';
        $difficulty  = isset( $shortfall['requestedDifficulty'] ) ? (string) $shortfall['requestedDifficulty'] : '';
        $missing     = isset( $shortfall['shortfall'] ) ? (int) $shortfall['shortfall'] : 0;
        $key         = $category_id . '|' . $difficulty;

        if ( ! isset( $groups[ $key ] ) ) {
            $groups[ $key ] = [
                'categoryId'           => $category_id,
                'requestedDifficulty' => $difficulty,
                'shortfall'           => $missing,
            ];
        } elseif ( $missing > $groups[ $key ]['shortfall'] ) {
            $groups[ $key ]['shortfall'] = $missing;
        }
    }
    return array_values( $groups );
}

/**
 * Formats one Dutch notice for one response line, or null when the line is
 * feasible. `$response_line` is one entry of the endpoint's `lines` array
 * (`feasible`, `invalid`, `shortfalls`); `$category_labels` and
 * `$difficulty_labels` are `slug => Dutch label` maps read from the product
 * field group. A shortfall whose Category id has no known label falls back
 * to the raw id (a stale/removed Category between checkout and the field
 * group refresh) rather than losing the line silently. Pure.
 */
function pubquiz_feasibility_format_notice( int $line_number, array $response_line, array $category_labels, array $difficulty_labels ) {
    if ( ! empty( $response_line['feasible'] ) ) {
        return null;
    }

    if ( ! empty( $response_line['invalid'] ) ) {
        return "Quiz {$line_number}: deze samenstelling kan niet worden gemaakt.";
    }

    $shortfalls = is_array( $response_line['shortfalls'] ?? null ) ? $response_line['shortfalls'] : [];
    if ( empty( $shortfalls ) ) {
        // feasible === false with no invalid reason and no shortfalls is not
        // a shape the endpoint documents; fail open on this one line rather
        // than print an empty notice.
        return null;
    }

    $segments = [];
    foreach ( pubquiz_feasibility_group_shortfalls( $shortfalls ) as $group ) {
        $category_label   = $category_labels[ $group['categoryId'] ] ?? $group['categoryId'];
        $difficulty_label = $difficulty_labels[ $group['requestedDifficulty'] ] ?? $group['requestedDifficulty'];

        $segments[] = "{$category_label} ({$difficulty_label}): {$group['shortfall']} vragen te weinig";
    }

    return "Quiz {$line_number}: " . implode( '; ', $segments );
}

/**
 * The active `order.updated` webhook's delivery URL and secret, the same
 * lookup `setup-shop.php`'s `pubquiz_ensure_webhook()` uses
 * (`WC_Data_Store::load('webhook')`). Null when no such webhook exists
 * (fail-open case 1).
 */
function pubquiz_feasibility_find_webhook() {
    if ( ! class_exists( 'WC_Data_Store' ) ) {
        return null;
    }

    $data_store = WC_Data_Store::load( 'webhook' );
    foreach ( $data_store->get_webhooks_ids() as $id ) {
        $webhook = new WC_Webhook( $id );
        if ( PUBQUIZ_FEASIBILITY_WEBHOOK_TOPIC === $webhook->get_topic() && 'active' === $webhook->get_status() ) {
            return [
                'delivery_url' => $webhook->get_delivery_url(),
                'secret'       => $webhook->get_secret(),
            ];
        }
    }
    return null;
}

/**
 * `slug => Dutch label` map for one field id of the given product's
 * Advanced Product Fields field group, via the plugin's own
 * `Field_Groups::get_field_groups_of_product()` (public API, same one
 * `setup-field-group.php`'s doc comment points at) -- not a re-read of the
 * raw `_wapf_fieldgroup` postmeta. Empty when the plugin isn't active, the
 * product has no field group, or the field id isn't found.
 */
function pubquiz_feasibility_choice_labels( $product, string $field_id ) {
    if ( ! class_exists( '\\SW_WAPF\\Includes\\Classes\\Field_Groups' ) || ! $product ) {
        return [];
    }

    $labels = [];
    foreach ( \SW_WAPF\Includes\Classes\Field_Groups::get_field_groups_of_product( $product ) as $field_group ) {
        foreach ( $field_group->fields as $field ) {
            if ( $field_id !== $field->id ) {
                continue;
            }
            foreach ( $field->options['choices'] ?? [] as $choice ) {
                if ( isset( $choice['slug'], $choice['label'] ) ) {
                    $labels[ (string) $choice['slug'] ] = (string) $choice['label'];
                }
            }
        }
    }
    return $labels;
}

/** One `wc_get_logger()` warning under source `pubquiz-feasibility`, never a secret or an email. */
function pubquiz_feasibility_log( string $message ) {
    if ( function_exists( 'wc_get_logger' ) ) {
        wc_get_logger()->warning( $message, [ 'source' => PUBQUIZ_FEASIBILITY_LOG_SOURCE ] );
    }
}

add_action(
    'woocommerce_after_checkout_validation',
    function ( $data, $errors ) {
        $billing_email = isset( $data['billing_email'] ) ? trim( (string) $data['billing_email'] ) : '';
        if ( '' === $billing_email || ! function_exists( 'WC' ) || ! WC()->cart ) {
            return;
        }

        $cart_items = WC()->cart->get_cart();
        $lines      = pubquiz_feasibility_build_lines( $cart_items );
        if ( empty( $lines ) ) {
            return;
        }

        $webhook = pubquiz_feasibility_find_webhook();
        if ( null === $webhook || empty( $webhook['delivery_url'] ) || empty( $webhook['secret'] ) ) {
            pubquiz_feasibility_log( 'no active order.updated webhook found; skipping feasibility check' );
            return;
        }

        $endpoint_url = pubquiz_feasibility_endpoint_url( $webhook['delivery_url'] );
        $raw_body     = wp_json_encode( pubquiz_feasibility_request_body( $billing_email, $lines ) );
        $signature    = pubquiz_feasibility_sign( $raw_body, $webhook['secret'] );

        $response = wp_remote_post(
            $endpoint_url,
            [
                'timeout' => PUBQUIZ_FEASIBILITY_TIMEOUT_SECONDS,
                'headers' => [
                    'Content-Type'                       => 'application/json',
                    PUBQUIZ_FEASIBILITY_SIGNATURE_HEADER => $signature,
                ],
                'body'    => $raw_body,
            ]
        );

        if ( is_wp_error( $response ) ) {
            pubquiz_feasibility_log( 'request failed: ' . $response->get_error_message() );
            return;
        }

        $status = (int) wp_remote_retrieve_response_code( $response );
        if ( 200 !== $status ) {
            pubquiz_feasibility_log( "unexpected status {$status}" );
            return;
        }

        $decoded = json_decode( wp_remote_retrieve_body( $response ), true );
        if ( ! is_array( $decoded ) || ! isset( $decoded['lines'] ) || ! is_array( $decoded['lines'] ) ) {
            pubquiz_feasibility_log( 'response was not valid JSON with a lines array' );
            return;
        }

        if ( count( $decoded['lines'] ) !== count( $lines ) ) {
            pubquiz_feasibility_log( 'response lines count did not match request lines count' );
            return;
        }

        // Category/Difficulty labels: read once, from the first cart item
        // that produced a line (every Pubquiz line uses the same product's
        // field group in this shop -- one product, per shop/README.md).
        $product           = null;
        foreach ( $cart_items as $cart_item ) {
            if ( null !== pubquiz_feasibility_line_from_cart_item( $cart_item ) ) {
                $product = $cart_item['data'] ?? ( isset( $cart_item['product_id'] ) ? wc_get_product( $cart_item['product_id'] ) : null );
                break;
            }
        }
        $category_labels   = pubquiz_feasibility_choice_labels( $product, PUBQUIZ_FEASIBILITY_CATEGORIES_FIELD_ID );
        $difficulty_labels = pubquiz_feasibility_choice_labels( $product, PUBQUIZ_FEASIBILITY_DIFFICULTY_FIELD_ID );

        foreach ( $decoded['lines'] as $index => $response_line ) {
            if ( ! is_array( $response_line ) ) {
                continue;
            }
            $line_number = $index + 1;
            $notice      = pubquiz_feasibility_format_notice( $line_number, $response_line, $category_labels, $difficulty_labels );
            if ( null !== $notice ) {
                $errors->add( "pubquiz_feasibility_{$line_number}", esc_html( $notice ) );
            }
        }
    },
    10,
    2
);
