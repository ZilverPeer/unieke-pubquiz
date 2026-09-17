<?php
/**
 * Plugin Name: Pubquiz Front Page Redirects
 * Description: There is exactly one selling page (spec #142 "Front page",
 *              ticket #145): the Pubquiz product's own URL, and the Winkel
 *              archive URL when it is not already the front page, both
 *              301-redirect to the front page. No other URL is redirected.
 *
 * The front page is the Winkel page (`page_on_front` = `wc_get_page_id(
 * 'shop' )`, `show_on_front = page` -- setup-shop.php, ticket #70 fix round,
 * unchanged by this ticket), rendered by this theme's own
 * `woocommerce/archive-product.php` as the landing page. Visiting the
 * product's single-product URL or the Winkel archive URL directly would
 * otherwise show WooCommerce's bare default product/archive markup
 * side-by-side with the landing page at `/` -- two selling pages for one
 * product, which spec #142 explicitly rules out ("Erik, I want the
 * product's own URL and the Winkel archive to land on the front page, so
 * that there is exactly one selling page").
 *
 * `is_shop()` is already true on the front page itself (the front page's
 * main query *is* the product archive query -- see
 * `woocommerce/archive-product.php`'s own docblock), so the `is_shop()`
 * branch below is guarded with `! is_front_page()`: today (page_on_front
 * pointed at Winkel) that combination never actually redirects anything --
 * it only matters if `page_on_front` is ever pointed elsewhere later,
 * making a direct request for the Winkel archive URL distinct from the
 * front page again.
 *
 * This is a must-use plugin: it ships with the wp-env setup and, unmodified,
 * with the WordPress container on the VPS later. No environment guard, same
 * as pubquiz-hold-processing.php and pubquiz-checkout-meta.php.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

add_action(
    'template_redirect',
    function () {
        if ( is_singular( 'product' ) ) {
            wp_safe_redirect( home_url( '/' ), 301 );
            exit;
        }

        if ( is_shop() && ! is_front_page() ) {
            wp_safe_redirect( home_url( '/' ), 301 );
            exit;
        }
    }
);
