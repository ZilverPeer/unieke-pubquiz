<?php
/**
 * Plugin Name: Pubquiz Checkout Redirect
 * Description: A successful add-to-cart for a Pubquiz-configured item goes
 *              straight to checkout instead of the product or cart page --
 *              spec 6 "straight to checkout" (#142), ticket #147. The
 *              product is sold individually (spec 3c, #83) so a buyer never
 *              needs the cart to change a quantity; the cart stays reachable
 *              from the header icon (`pubquiz-storefront-chrome.php`) for
 *              adding a second, differently configured Quiz to the same
 *              order (see `docs/walkthrough-customer-journey.md`, "A second
 *              Quiz in the same order").
 *
 * Cart matching rule: a cart item is a Pubquiz item when its own `wapf`
 * array carries a `locale` field with a non-empty string `raw` value --
 * exactly `pubquiz-withdrawal-waiver.php`'s
 * `pubquiz_waiver_cart_item_is_pubquiz()` / `pubquiz_waiver_cart_has_pubquiz_item()`,
 * reused here via `function_exists()` (mu-plugins load alphabetically;
 * "pubquiz-checkout-redirect.php" sorts before "pubquiz-withdrawal-waiver.php",
 * so this file cannot assume it has already loaded -- the guard makes the
 * dependency explicit rather than order-dependent) rather than re-derived a
 * third time (`pubquiz-checkout-feasibility.php` already carries a second
 * copy of the same check on the same `wapf` array shape).
 *
 * Three behaviours, WooCommerce's own hooks, no template override:
 *
 * 1. `woocommerce_add_to_cart_redirect` returns the checkout URL for a
 *    successful add-to-cart of a Pubquiz item; WooCommerce's own
 *    `WC_Form_Handler::add_to_cart_action()` redirects there directly
 *    (`wp_safe_redirect( $url ); exit;`) instead of consulting
 *    `woocommerce_cart_redirect_after_add` at all -- verified against the
 *    installed WooCommerce's own `includes/class-wc-form-handler.php`. A
 *    non-Pubquiz product (should one ever exist) falls through unchanged.
 * 2. `pre_option_woocommerce_cart_redirect_after_add` filtered to `'yes'` --
 *    belt and braces for any add-to-cart path that reads the option
 *    directly rather than going through `add_to_cart_action()`'s filter
 *    (e.g. a future non-Pubquiz product without this plugin's redirect), so
 *    the *option* itself also reflects "redirect after add" rather than
 *    only this plugin's own filter. Behaviour lives here, not in the
 *    bootstrap (`setup-shop.php`), because it is part of what "straight to
 *    checkout" means, not shop bootstrap data.
 * 3. `pre_option_woocommerce_enable_ajax_add_to_cart` filtered to `'no'` --
 *    the product archive/loop's AJAX add-to-cart button would otherwise add
 *    the item without a full page load and never hit
 *    `WC_Form_Handler::add_to_cart_action()` (and therefore never hit filter
 *    1 above) at all; disabling AJAX makes the add-to-cart form on the
 *    product page do a normal POST-and-redirect instead (verified against
 *    `WC_Frontend_Scripts::load_scripts()` and `wc-template-functions.php`,
 *    both of which gate AJAX add-to-cart on this exact option).
 *
 * `woocommerce_cart_redirect_after_error` (the AJAX add-to-cart error path,
 * `WC_AJAX::add_to_cart()`) is left untouched: with AJAX add-to-cart
 * disabled by filter 3 above, that code path never runs for this shop's one
 * product, so there is nothing here to redirect.
 *
 * "Nog een quiz toevoegen" link: `woocommerce_review_order_after_cart_contents`
 * prints one `<tr>` inside the checkout review-order table (the same hook
 * `checkout/review-order.php` fires right after the cart item rows,
 * `<tbody>` still open) with a link to the front page's configurator
 * section (`home_url( '/#samenstellen' )`, the landing page's anchor,
 * ticket #145). Markup only, no behaviour beyond a link into the existing
 * flow -- kept in this plugin per the brief rather than a template override.
 *
 * This is a must-use plugin: it ships with the wp-env setup and, unmodified,
 * with the WordPress container on the VPS later. No environment guard, same
 * as pubquiz-withdrawal-waiver.php and pubquiz-checkout-fields.php -- this is
 * real checkout behaviour, not a local-only shim.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * True if the current WooCommerce cart holds at least one Pubquiz-configured
 * item. Reuses `pubquiz-withdrawal-waiver.php`'s own function of the same
 * shape (`function_exists()` guard, see this file's doc comment); returns
 * false rather than erroring if that plugin somehow isn't loaded.
 */
function pubquiz_checkout_redirect_cart_has_pubquiz_item() {
    if ( ! function_exists( 'pubquiz_waiver_cart_has_pubquiz_item' ) ) {
        return false;
    }

    return pubquiz_waiver_cart_has_pubquiz_item();
}

/** 1. Straight to checkout after a successful add-to-cart of a Pubquiz item. */
add_filter(
    'woocommerce_add_to_cart_redirect',
    function ( $url ) {
        if ( pubquiz_checkout_redirect_cart_has_pubquiz_item() ) {
            return wc_get_checkout_url();
        }

        return $url;
    }
);

/** 2. `woocommerce_cart_redirect_after_add` reads as `'yes'` everywhere, without writing the option itself. */
add_filter(
    'pre_option_woocommerce_cart_redirect_after_add',
    function () {
        return 'yes';
    }
);

/** 3. AJAX add-to-cart reads as disabled everywhere, so the product form posts and redirects instead. */
add_filter(
    'pre_option_woocommerce_enable_ajax_add_to_cart',
    function () {
        return 'no';
    }
);

/**
 * "Nog een quiz toevoegen": one review-order row linking back to the
 * landing page's configurator section, immediately after the cart item
 * rows the same hook already follows in `checkout/review-order.php`.
 */
add_action(
    'woocommerce_review_order_after_cart_contents',
    function () {
        printf(
            '<tr class="pubquiz-add-another"><td colspan="2"><a href="%1$s">%2$s</a></td></tr>',
            esc_url( home_url( '/#samenstellen' ) ),
            esc_html__( 'Nog een quiz toevoegen', 'unieke-pubquiz' )
        );
    }
);
