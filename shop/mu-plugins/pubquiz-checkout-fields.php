<?php
/**
 * Plugin Name: Pubquiz Checkout Fields
 * Description: At checkout only, for a cart made up entirely of virtual
 *              products (the Pubquiz product is virtual, spec #55 "Guest
 *              checkout, minimal fields"), removes every billing field
 *              except first name, last name and email -- WooCommerce
 *              already skips the shipping fields for a virtual-only cart by
 *              itself, this plugin does the same for billing. Scoped to
 *              `is_checkout()` so My Account -> Addresses (which reuses the
 *              same `woocommerce_billing_fields` filter) keeps every
 *              billing field -- a customer's saved address is independent
 *              of what any one cart happens to contain.
 *
 * This is a must-use plugin: it ships with the wp-env setup and, unmodified,
 * with the WordPress container on the VPS later. No environment guard, same
 * as pubquiz-hold-processing.php, pubquiz-downloads.php and
 * pubquiz-customer-notice.php -- this is real checkout behaviour, not a
 * local-only shim.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/** Billing field keys kept for a virtual-only cart. Every other billing_* field is dropped. */
const PUBQUIZ_MINIMAL_BILLING_FIELDS = array( 'billing_first_name', 'billing_last_name', 'billing_email' );

add_filter(
    'woocommerce_billing_fields',
    function ( $fields ) {
        if ( is_admin() && ! wp_doing_ajax() ) {
            // wp-admin's "Add order manually" screen re-uses this filter outside a
            // customer cart context, where WC()->cart is unreliable -- leave it alone.
            return $fields;
        }

        // is_checkout() is true both for the checkout page itself and for the
        // wc-ajax checkout submission (WC_AJAX::checkout() defines the
        // WOOCOMMERCE_CHECKOUT constant is_checkout() checks before calling
        // process_checkout()) -- so this still trims the fields WooCommerce
        // validates against on the real submission, not just what renders.
        if ( ! is_checkout() ) {
            return $fields;
        }

        if ( ! function_exists( 'WC' ) || ! WC()->cart || WC()->cart->needs_shipping() ) {
            return $fields;
        }

        return array_intersect_key( $fields, array_flip( PUBQUIZ_MINIMAL_BILLING_FIELDS ) );
    }
);
