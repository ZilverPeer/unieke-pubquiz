<?php
/**
 * Plugin Name: Pubquiz Hold At Processing
 * Description: Keeps a paid order containing a Pubquiz line item at
 *              `processing` instead of letting WooCommerce auto-complete it.
 *
 * WooCommerce's payment_complete() -- the standard call every real payment
 * gateway makes on success -- normally jumps straight to `completed` for an
 * order made up entirely of virtual, downloadable products (the Pubquiz
 * product is both), skipping `processing` entirely. That would fire the
 * customer's completed-order email (with download links to files that don't
 * exist yet) before the webhook that starts generation has even had a
 * chance to run, since generation is triggered by the order reaching
 * `processing` (see CONTEXT.md "Generation trigger"). This filter runs in
 * every environment, including production: it isn't a local-only quirk, and
 * production gateways will call payment_complete() same as the local test
 * gateway does.
 *
 * Matches on the presence of the `pubquiz_locale` line item meta key (the
 * `locale` entry of CHECKOUT_META_KEYS, src/domain/checkout.ts) rather than
 * a specific product id/slug, so it holds any order containing a
 * Pubquiz-configured line item regardless of which product record wrote it.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

add_filter(
    'woocommerce_payment_complete_order_status',
    function ( $status, $order_id, $order ) {
        if ( ! $order ) {
            return $status;
        }

        foreach ( $order->get_items() as $item ) {
            if ( '' !== (string) $item->get_meta( 'pubquiz_locale', true ) ) {
                return 'processing';
            }
        }

        return $status;
    },
    10,
    3
);
