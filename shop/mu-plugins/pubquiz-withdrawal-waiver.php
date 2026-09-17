<?php
/**
 * Plugin Name: Pubquiz Withdrawal Waiver
 * Description: Adds one required checkbox to checkout -- consent to
 *              immediate delivery and acknowledgement that the right of
 *              withdrawal is lost once delivery starts -- for any cart
 *              containing a Pubquiz-configured item. Storing, displaying and
 *              admin-surfacing of the consent extends the customer-notice
 *              plugin's hook points (spec 6, #142; ticket #148).
 *
 * Cart matching rule (checkout page, before the order exists): a cart item
 * is a Pubquiz item when its own `wapf` array (the field data Advanced
 * Product Fields attaches to a cart item at add-to-cart time, distinct from
 * the `_wapf_meta` *order line* meta the same data becomes once the order is
 * created -- see pubquiz-checkout-meta.php's doc comment and
 * class-product-controller.php's `create_order_line_item()`) carries a
 * `locale` field with a non-empty string `raw` value. Same presence check as
 * pubquiz-checkout-feasibility.php's `pubquiz_feasibility_wapf_field()` /
 * `pubquiz_feasibility_line_from_cart_item()`, which already uses exactly
 * this rule to decide which cart lines are Pubquiz lines at the same point
 * in checkout (`woocommerce_after_checkout_validation`, cart still exists,
 * order does not yet) -- reused here rather than invented a second time.
 * Order-side checks (thank-you page, the processing mail, the admin order
 * screen) instead reuse `pubquiz_order_has_pubquiz_item( $order )` from
 * pubquiz-customer-notice.php (`function_exists` guard; mu-plugins load
 * alphabetically, and "pubquiz-customer-notice.php" sorts before
 * "pubquiz-withdrawal-waiver.php", so it is always already defined).
 *
 * Field: checkbox `pubquiz_withdrawal_waiver`, rendered on
 * `woocommerce_review_order_before_submit` (so it sits directly above the
 * "Plaats bestelling" button WooCommerce's own checkout template renders
 * right after that hook). Validated on `woocommerce_checkout_process`
 * against the raw POST value (this hook runs before `create_order()`, so
 * there is no order yet to read from). Stored on
 * `woocommerce_checkout_create_order` as order meta -- the accepted
 * timestamp in UTC ISO 8601 (`gmdate( 'c' )`, matching
 * `pubquiz_withdrawal_waiver_accepted_at`) and the exact label text the
 * customer agreed to (`pubquiz_withdrawal_waiver_label`, a record of what
 * was shown even if the placeholder wording above changes later).
 *
 * This is a must-use plugin: it ships with the wp-env setup and,
 * unmodified, with the WordPress container on the VPS later. No environment
 * guard, same as pubquiz-hold-processing.php, pubquiz-operator-mail.php,
 * pubquiz-downloads.php and pubquiz-customer-notice.php -- this is real
 * checkout behaviour (and a legal requirement), not a local-only shim.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/** placeholder wording, final text in the deployment spec */
const PUBQUIZ_WAIVER_LABEL = 'Ik wil mijn quiz direct ontvangen en zie af van mijn herroepingsrecht zodra de levering is gestart.';
/** placeholder wording, final text in the deployment spec */
const PUBQUIZ_WAIVER_ERROR = 'Vink aan dat je afziet van je herroepingsrecht om te bestellen.';
/** placeholder wording, final text in the deployment spec */
const PUBQUIZ_WAIVER_CONFIRMATION = 'Je hebt op %s ingestemd met directe levering en afgezien van je herroepingsrecht.';

/** The checkbox field name, posted at checkout and read back from order meta. */
const PUBQUIZ_WAIVER_FIELD = 'pubquiz_withdrawal_waiver';

/** Order meta key: UTC ISO 8601 timestamp (`gmdate( 'c' )`) of acceptance. */
const PUBQUIZ_WAIVER_META_ACCEPTED_AT = 'pubquiz_withdrawal_waiver_accepted_at';
/** Order meta key: the exact label text shown when the customer accepted. */
const PUBQUIZ_WAIVER_META_LABEL = 'pubquiz_withdrawal_waiver_label';

/**
 * True if the given WAPF cart item array (one entry of
 * `WC()->cart->get_cart()`) is a Pubquiz-configured line -- presence of a
 * `locale` field with a non-empty string `raw` value in the item's own
 * `wapf` array. Mirrors pubquiz-checkout-feasibility.php's
 * `pubquiz_feasibility_wapf_field()`/`pubquiz_feasibility_line_from_cart_item()`
 * exactly (same field, same presence check), not re-derived independently.
 */
function pubquiz_waiver_cart_item_is_pubquiz( array $cart_item ) {
    if ( empty( $cart_item['wapf'] ) || ! is_array( $cart_item['wapf'] ) ) {
        return false;
    }

    foreach ( $cart_item['wapf'] as $field ) {
        if ( isset( $field['id'], $field['raw'] )
            && 'locale' === $field['id']
            && is_string( $field['raw'] )
            && '' !== $field['raw']
        ) {
            return true;
        }
    }

    return false;
}

/** True if the current WooCommerce cart holds at least one Pubquiz-configured item. */
function pubquiz_waiver_cart_has_pubquiz_item() {
    if ( ! function_exists( 'WC' ) || ! WC()->cart ) {
        return false;
    }

    foreach ( WC()->cart->get_cart() as $cart_item ) {
        if ( pubquiz_waiver_cart_item_is_pubquiz( $cart_item ) ) {
            return true;
        }
    }

    return false;
}

/**
 * True if the checkbox was posted as accepted (`'1'`, the value the
 * rendered `<input type="checkbox" value="1">` sends when checked; missing
 * entirely when unchecked, per HTML form semantics).
 */
function pubquiz_waiver_was_accepted_in_post() {
    return isset( $_POST[ PUBQUIZ_WAIVER_FIELD ] ) && '1' === $_POST[ PUBQUIZ_WAIVER_FIELD ]; // phpcs:ignore WordPress.Security.NonceVerification.Missing -- read-only presence check, WooCommerce's own checkout nonce covers the whole submission.
}

/**
 * The confirmation line for a given UTC ISO 8601 acceptance timestamp,
 * formatted in the site's own timezone via `wc_format_datetime()` (the same
 * function WooCommerce itself uses to display order dates -- converts a
 * `WC_DateTime` from its internal UTC storage to `wc_timezone_string()` for
 * display).
 */
function pubquiz_waiver_confirmation_text( $accepted_at_iso ) {
    $datetime = wc_string_to_datetime( $accepted_at_iso );
    return sprintf( PUBQUIZ_WAIVER_CONFIRMATION, wc_format_datetime( $datetime, 'd-m-Y H:i' ) );
}

/** Checkout: the checkbox itself, directly above "Plaats bestelling". */
add_action(
    'woocommerce_review_order_before_submit',
    function () {
        if ( ! pubquiz_waiver_cart_has_pubquiz_item() ) {
            return;
        }
        ?>
        <p class="form-row validate-required pubquiz-withdrawal-waiver-row" id="pubquiz_withdrawal_waiver_field">
            <label for="<?php echo esc_attr( PUBQUIZ_WAIVER_FIELD ); ?>">
                <input type="checkbox"
                    name="<?php echo esc_attr( PUBQUIZ_WAIVER_FIELD ); ?>"
                    id="<?php echo esc_attr( PUBQUIZ_WAIVER_FIELD ); ?>"
                    value="1"
                    <?php checked( pubquiz_waiver_was_accepted_in_post() ); ?> />
                <?php echo esc_html( PUBQUIZ_WAIVER_LABEL ); ?> <span class="required">*</span>
            </label>
        </p>
        <?php
    }
);

/** Checkout: require the checkbox for any cart holding a Pubquiz item. */
add_action(
    'woocommerce_checkout_process',
    function () {
        if ( ! pubquiz_waiver_cart_has_pubquiz_item() ) {
            return;
        }

        if ( ! pubquiz_waiver_was_accepted_in_post() ) {
            wc_add_notice( PUBQUIZ_WAIVER_ERROR, 'error' );
        }
    }
);

/**
 * Order creation: store the accepted timestamp and the exact label text.
 * Runs before `woocommerce_checkout_process`'s notice could have blocked
 * order creation, so this only ever fires with a real acceptance already
 * validated -- but the cart/POST check is repeated here too as defence
 * (the hook shape doesn't guarantee ordering against future code).
 */
add_action(
    'woocommerce_checkout_create_order',
    function ( $order, $data ) {
        if ( ! pubquiz_waiver_cart_has_pubquiz_item() || ! pubquiz_waiver_was_accepted_in_post() ) {
            return;
        }

        $order->update_meta_data( PUBQUIZ_WAIVER_META_ACCEPTED_AT, gmdate( 'c' ) );
        $order->update_meta_data( PUBQUIZ_WAIVER_META_LABEL, PUBQUIZ_WAIVER_LABEL );
    },
    10,
    2
);

/** Order-received (thank-you) page: one line, after the customer notice. */
add_action(
    'woocommerce_thankyou',
    function ( $order_id ) {
        $order = wc_get_order( $order_id );
        if ( ! function_exists( 'pubquiz_order_has_pubquiz_item' ) || ! pubquiz_order_has_pubquiz_item( $order ) ) {
            return;
        }

        $accepted_at = $order->get_meta( PUBQUIZ_WAIVER_META_ACCEPTED_AT, true );
        if ( '' === (string) $accepted_at ) {
            return;
        }

        printf( '<p class="pubquiz-withdrawal-waiver">%s</p>', esc_html( pubquiz_waiver_confirmation_text( $accepted_at ) ) );
    }
);

/**
 * The processing-order mail only (`WC_Email_Customer_Processing_Order::id`
 * is `customer_processing_order`), html and plain text -- same scoping as
 * pubquiz-customer-notice.php's own `woocommerce_email_order_details` hook.
 * The completed mail is untouched (no hook here filters it).
 */
add_action(
    'woocommerce_email_order_details',
    function ( $order, $sent_to_admin, $plain_text, $email ) {
        if ( $sent_to_admin || ! $email || 'customer_processing_order' !== $email->id ) {
            return;
        }
        if ( ! function_exists( 'pubquiz_order_has_pubquiz_item' ) || ! pubquiz_order_has_pubquiz_item( $order ) ) {
            return;
        }

        $accepted_at = $order->get_meta( PUBQUIZ_WAIVER_META_ACCEPTED_AT, true );
        if ( '' === (string) $accepted_at ) {
            return;
        }

        $text = pubquiz_waiver_confirmation_text( $accepted_at );
        if ( $plain_text ) {
            echo esc_html( $text ) . "\n\n";
        } else {
            printf( '<p class="pubquiz-withdrawal-waiver">%s</p>', esc_html( $text ) );
        }
    },
    10,
    4
);

/** wp-admin order screen: visible to the operator, right after the billing address block. */
add_action(
    'woocommerce_admin_order_data_after_billing_address',
    function ( $order ) {
        if ( ! function_exists( 'pubquiz_order_has_pubquiz_item' ) || ! pubquiz_order_has_pubquiz_item( $order ) ) {
            return;
        }

        $accepted_at = $order->get_meta( PUBQUIZ_WAIVER_META_ACCEPTED_AT, true );
        if ( '' === (string) $accepted_at ) {
            return;
        }

        printf(
            '<p class="pubquiz-withdrawal-waiver"><strong>%s</strong></p>',
            esc_html( pubquiz_waiver_confirmation_text( $accepted_at ) )
        );
    }
);
