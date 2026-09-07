<?php
/**
 * Plugin Name: Pubquiz Customer Notice
 * Description: Adds a Dutch notice -- "your quiz is being made, a mail with
 *              the download link follows within minutes" -- to the
 *              order-received (thank-you) page and to the processing-order
 *              mail, for orders containing a Pubquiz line item. The shop is
 *              Dutch-only by decision (spec #55), so the text lives here
 *              rather than going through next-intl, which only covers the
 *              Next.js app.
 *
 * Matches on the presence of the `pubquiz_locale` line item meta key (the
 * `locale` entry of CHECKOUT_META_KEYS, src/domain/checkout.ts) rather than
 * a specific product id/slug -- same matching rule as
 * pubquiz-hold-processing.php -- so it fires for any order containing a
 * Pubquiz-configured line item regardless of which product record wrote it,
 * and stays silent for an order that doesn't (e.g. a plain second product).
 *
 * This is a must-use plugin: it ships with the wp-env setup and, unmodified,
 * with the WordPress container on the VPS later. No environment guard, same
 * as pubquiz-hold-processing.php, pubquiz-operator-mail.php and
 * pubquiz-downloads.php.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/** The Dutch notice text, identical on the thank-you page and in the processing-order mail. */
const PUBQUIZ_CUSTOMER_NOTICE_TEXT = 'Je quiz wordt gemaakt. Je ontvangt binnen enkele minuten een e-mail met de downloadlink.';

/**
 * @param WC_Order|false $order
 * @return bool True if the order carries at least one Pubquiz-configured line item.
 */
function pubquiz_order_has_pubquiz_item( $order ) {
    if ( ! $order || ! is_a( $order, 'WC_Order' ) ) {
        return false;
    }

    foreach ( $order->get_items() as $item ) {
        if ( '' !== (string) $item->get_meta( 'pubquiz_locale', true ) ) {
            return true;
        }
    }

    return false;
}

/** Order-received (thank-you) page: fires once, right after WooCommerce's own order details. */
add_action(
    'woocommerce_thankyou',
    function ( $order_id ) {
        $order = wc_get_order( $order_id );
        if ( ! pubquiz_order_has_pubquiz_item( $order ) ) {
            return;
        }

        printf( '<p class="pubquiz-customer-notice">%s</p>', esc_html( PUBQUIZ_CUSTOMER_NOTICE_TEXT ) );
    }
);

/**
 * The processing-order mail: `woocommerce_email_order_details` fires for
 * every WooCommerce email that renders the order table (customer and admin
 * alike); filtered here to the customer's own processing-order email only
 * (`WC_Email_Customer_Processing_Order::id` is `customer_processing_order`).
 */
add_action(
    'woocommerce_email_order_details',
    function ( $order, $sent_to_admin, $plain_text, $email ) {
        if ( $sent_to_admin || ! $email || 'customer_processing_order' !== $email->id ) {
            return;
        }
        if ( ! pubquiz_order_has_pubquiz_item( $order ) ) {
            return;
        }

        if ( $plain_text ) {
            echo esc_html( PUBQUIZ_CUSTOMER_NOTICE_TEXT ) . "\n\n";
        } else {
            printf( '<p class="pubquiz-customer-notice">%s</p>', esc_html( PUBQUIZ_CUSTOMER_NOTICE_TEXT ) );
        }
    },
    10,
    4
);
