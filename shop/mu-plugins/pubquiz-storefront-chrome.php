<?php
/**
 * Plugin Name: Pubquiz Storefront Chrome
 * Description: Strips Storefront down to a bare header (logo, cart, account
 *              icon) with no primary menu, no breadcrumb, no sidebar and no
 *              footer widgets -- spec #69 / ticket #70.
 *
 * The shop is a single-product, one-page storefront: there is nothing for a
 * primary navigation menu, a breadcrumb trail or a blog sidebar to point at,
 * and the footer widget area and the mobile "handheld" footer bar (its own
 * cart/search/account shortcuts, redundant with the header) just repeat
 * chrome the header already has. Removing the actions that print them --
 * rather than hiding the markup with CSS -- keeps the rendered HTML itself
 * free of `id="site-navigation"`, `woocommerce-breadcrumb`, `id="secondary"`
 * and the footer-widgets/handheld-footer-bar markup, which is what the
 * acceptance checks (and a real visitor's page weight) care about.
 *
 * Hook names, callbacks and priorities below are read directly from the
 * installed Storefront theme's own `inc/storefront-template-hooks.php` and
 * `inc/woocommerce/storefront-woocommerce-template-hooks.php` (WooCommerce
 * active) -- `remove_action()` only unhooks a callback registered at the
 * exact same priority, so each one here mirrors the theme's `add_action()`
 * call it undoes:
 *
 *   storefront_header:
 *     storefront_secondary_navigation            @ 30
 *     storefront_primary_navigation_wrapper       @ 42
 *     storefront_primary_navigation                @ 50
 *     storefront_primary_navigation_wrapper_close @ 68
 *   storefront_before_content:
 *     woocommerce_breadcrumb (WooCommerce's own breadcrumb callback --
 *       there is no `storefront_breadcrumb` function in this theme)  @ 10
 *   storefront_sidebar:
 *     storefront_get_sidebar                      @ 10
 *   storefront_footer:
 *     storefront_footer_widgets                   @ 10
 *     storefront_handheld_footer_bar               @ 999
 *
 * Full-width content: Storefront's own `body_class` filter
 * (`class-storefront.php`) only adds `storefront-full-width-content`
 * (the class `.content-area`'s CSS actually keys off, per
 * `style.css`: `100%` width with it, `73.9%` without) when
 * `is_active_sidebar( 'sidebar-1' )` is false -- checked empirically
 * against this instance and it is *not* false: `wp widget list sidebar-1`
 * shows WordPress's own default widgets (Search, Recent Posts, Recent
 * Comments, Archives, Categories), added automatically on first theme
 * activation, still sitting there unused now that the sidebar itself never
 * renders. So this plugin adds the class itself via a `body_class` filter
 * below, unconditionally, rather than relying on that theme behaviour or
 * emptying the sidebar (which would depend on those default widgets never
 * coming back, e.g. after a theme switch) -- see shop/README.md "Chrome"
 * for the empirical check.
 *
 * This is a must-use plugin: it ships with the wp-env setup and, unmodified,
 * with the WordPress container on the VPS later. No environment guard, same
 * as pubquiz-hold-processing.php, pubquiz-customer-notice.php and
 * pubquiz-downloads.php.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

add_action(
    'init',
    function () {
        remove_action( 'storefront_header', 'storefront_secondary_navigation', 30 );
        remove_action( 'storefront_header', 'storefront_primary_navigation_wrapper', 42 );
        remove_action( 'storefront_header', 'storefront_primary_navigation', 50 );
        remove_action( 'storefront_header', 'storefront_primary_navigation_wrapper_close', 68 );

        remove_action( 'storefront_before_content', 'woocommerce_breadcrumb', 10 );

        remove_action( 'storefront_sidebar', 'storefront_get_sidebar', 10 );

        remove_action( 'storefront_footer', 'storefront_footer_widgets', 10 );
        remove_action( 'storefront_footer', 'storefront_handheld_footer_bar', 999 );
    }
);

/**
 * `WC_Storefront::woocommerce_scripts()` enqueues the handheld-footer-bar
 * script unconditionally (`inc/woocommerce/class-storefront-woocommerce.php`)
 * -- independent of the `storefront_handheld_footer_bar` action removed
 * above, so with only that removal the page still carried a dead
 * `<script id="storefront-handheld-footer-bar-js" ...>` tag pointing at a
 * script with nothing left to attach to. `WC_Storefront::woocommerce_scripts()`
 * enqueues it on `wp_enqueue_scripts` at priority 20 itself; mu-plugins load
 * before the theme's `functions.php`, so a `remove_action`/`wp_dequeue_script`
 * registered at that same priority here would run *first* (same-priority
 * callbacks run in registration order) and dequeue nothing before the theme
 * enqueues it after -- priority 21 guarantees this runs after.
 */
add_action(
    'wp_enqueue_scripts',
    function () {
        wp_dequeue_script( 'storefront-handheld-footer-bar' );
    },
    21
);

/**
 * Makes `.content-area` (`#primary`) span the full page: see the file
 * docblock's "Full-width content" note for why Storefront's own
 * `is_active_sidebar( 'sidebar-1' )` check doesn't already do this here.
 */
add_filter(
    'body_class',
    function ( $classes ) {
        $classes[] = 'storefront-full-width-content';
        return $classes;
    }
);

/**
 * The account icon link, right after the cart (`storefront_header_cart` is
 * hooked at priority 60 -- see storefront-woocommerce-template-hooks.php).
 * A person-outline SVG plus visually-hidden "Mijn account" text, same
 * accessible-icon-link shape as the cart link it sits next to.
 */
add_action(
    'storefront_header',
    function () {
        // The shop is Dutch-only by decision (spec #55) -- see
        // pubquiz-customer-notice.php's docblock -- so the label is a
        // literal Dutch string, same as that plugin, not run through
        // WordPress's own gettext (there is no "Mijn account" msgid to
        // translate; Storefront's own string is the English "My account").
        printf(
            '<a href="%1$s" class="pubquiz-account-link" aria-label="%2$s"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><path d="M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v3h20v-3c0-3.33-6.67-5-10-5z"/></svg><span class="screen-reader-text">%2$s</span></a>',
            esc_url( wc_get_page_permalink( 'myaccount' ) ),
            esc_html( 'Mijn account' )
        );
    },
    61
);
