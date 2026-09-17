<?php
/**
 * Unieke Pubquiz child theme -- functions.php (ticket #143).
 *
 * Storefront (the parent) owns the page skeleton (`storefront_header`,
 * `storefront_before_content`, `storefront_footer`, ...); this child theme
 * only replaces the hooks that print brand chrome (site branding, header
 * search, header cart, the footer credit line) and lets everything else
 * Storefront prints keep running. The must-use plugin
 * `pubquiz-storefront-chrome.php` (ticket #70) removes navigation,
 * breadcrumb, sidebar and footer-widgets output; this file does not touch
 * or duplicate what that plugin already does -- see its own docblock.
 *
 * Rule from spec #142 ("Implementation Decisions"): the theme owns the
 * look, must-use plugins own behaviour. Nothing here reads or writes an
 * order, a cart total's business meaning, or a WooCommerce setting --
 * only markup and enqueues.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * The wordmark's literal text (spec #142: "the wordmark is typographic
 * (Archivo 900)"; #143's header/footer decisions: "HTML text `Unieke
 * Pubquiz`"). Not `get_bloginfo( 'name' )`: the WordPress site title is
 * still "Pubquiz" (set before this spec, renaming it is not part of this
 * ticket's scope -- see the PR body "Out of scope") and would print the
 * wrong brand text in the header and footer.
 */
define( 'PUBQUIZ_WORDMARK_TEXT', 'Unieke Pubquiz' );

/**
 * Footer legal identity, spec #142 "Footer and legal block": one place for
 * the values the footer prints, placeholders until the deployment spec
 * fills them in. Moved out to `inc/identity.php` (ticket #144) so the
 * bootstrap's mail-branding step can `require` the exact same array by path
 * for the processing mail's footer text -- see that file's own docblock.
 */
define( 'PUBQUIZ_FOOTER_IDENTITY', require __DIR__ . '/inc/identity.php' );

/**
 * Fonts and base styles. `storefront-child-style` (Storefront's own
 * `child_scripts()`, class-storefront.php) already enqueues this file
 * (`style.css`, `get_stylesheet_uri()`) after the parent's own CSS, so the
 * child stylesheet only needs to `@import` the split-out token/font/base
 * rules -- see style.css. Storefront's own Google Fonts enqueue
 * (`storefront-fonts`, registered in `scripts()` at priority 10 on
 * `wp_enqueue_scripts`) is removed here so nothing in the served HTML ever
 * requests `fonts.googleapis.com`; the fonts this theme uses instead are
 * the woff2 files under assets/fonts/, referenced by relative url() from
 * assets/css/base.css, so they are served from the theme directory itself.
 */
add_action(
    'wp_enqueue_scripts',
    function () {
        wp_dequeue_style( 'storefront-fonts' );
        wp_deregister_style( 'storefront-fonts' );
    },
    20
);

/**
 * Header: replace Storefront's site branding, header search and header
 * cart with the brand wordmark, a cart link with the item count, and
 * (unchanged) the account link the chrome plugin already added at
 * `storefront_header` priority 61 -- see this file's "Header" section
 * below for why the account link is not duplicated here.
 *
 * Priorities mirror the callbacks they replace, read from the installed
 * Storefront theme's own `inc/storefront-template-hooks.php` and
 * `inc/woocommerce/storefront-woocommerce-template-hooks.php`:
 *
 *   storefront_header:
 *     storefront_header_container        @  0  (opens <div class="col-full">)
 *     storefront_site_branding           @ 20  (WordPress: logo/site title)
 *     storefront_header_container_close  @ 41  (closes it, *before* the
 *                                                cart at 60 -- Storefront
 *                                                normally reopens a second
 *                                                `col-full-nav` wrapper via
 *                                                `storefront_primary_navigation_wrapper`
 *                                                at 42 for the nav + cart;
 *                                                the chrome plugin removes
 *                                                that reopen along with the
 *                                                nav, ticket #70, so without
 *                                                this theme's own container
 *                                                the cart and account links
 *                                                render outside any
 *                                                `col-full` at all -- fixed
 *                                                empirically, ticket #143
 *                                                fix round 1: the wordmark
 *                                                sat on its own row with the
 *                                                icons wrapped underneath at
 *                                                every width, screenshots
 *                                                product-375.png and
 *                                                checkout-1280.png)
 *     storefront_product_search          @ 40  (WooCommerce: header search form)
 *     storefront_header_cart             @ 60  (WooCommerce: cart icon + fly-out)
 *
 * `storefront_header_container`/`_close` are removed and replaced with this
 * theme's own open (priority 0) and close (65, after the chrome plugin's
 * account link at 61) so the wordmark, the cart link and the account link
 * are all printed inside one `.col-full`, which `assets/css/base.css`
 * turns into a single flex row (wordmark left, cart and account grouped
 * right via `margin-left: auto` on the cart link) at every width.
 */
add_action(
    'init',
    function () {
        remove_action( 'storefront_header', 'storefront_header_container', 0 );
        remove_action( 'storefront_header', 'storefront_site_branding', 20 );
        remove_action( 'storefront_header', 'storefront_header_container_close', 41 );
        remove_action( 'storefront_header', 'storefront_product_search', 40 );
        remove_action( 'storefront_header', 'storefront_header_cart', 60 );
    }
);

add_action(
    'storefront_header',
    function () {
        echo '<div class="col-full">';
    },
    0
);

add_action(
    'storefront_header',
    function () {
        echo '</div>';
    },
    65
);

/**
 * The wordmark, HTML text (not an image -- spec #142 decisions), linking
 * home. Same slot and priority `storefront_site_branding` used.
 */
add_action(
    'storefront_header',
    function () {
        printf(
            '<div class="pubquiz-site-branding"><a href="%1$s" class="pubquiz-wordmark" rel="home">%2$s</a></div>',
            esc_url( home_url( '/' ) ),
            esc_html( PUBQUIZ_WORDMARK_TEXT )
        );
    },
    20
);

/**
 * The cart link, with the item count from the real cart (spec #142's
 * "cart icon with item count"). `WC()->cart` is available on the front
 * end by the time `storefront_header` fires (WooCommerce's own
 * `wc_load_cart()` runs on `wp_loaded`, well before `template_redirect` /
 * theme output). Same slot and priority `storefront_header_cart` used.
 */
add_action(
    'storefront_header',
    function () {
        $pubquiz_cart_count = 0;
        if ( function_exists( 'WC' ) && WC()->cart ) {
            $pubquiz_cart_count = WC()->cart->get_cart_contents_count();
        }
        $pubquiz_cart_label = sprintf(
            /* translators: %d: number of items in the cart. */
            _n( 'Winkelwagen, %d artikel', 'Winkelwagen, %d artikelen', $pubquiz_cart_count, 'unieke-pubquiz' ),
            $pubquiz_cart_count
        );

        printf(
            '<a href="%1$s" class="pubquiz-cart-link" aria-label="%2$s"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><path d="M3 3h2l.4 2M7 13h10l3-8H5.4M7 13L5.4 5M7 13l-2 4h13M9 21a1 1 0 100-2 1 1 0 000 2zm8 0a1 1 0 100-2 1 1 0 000 2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="pubquiz-cart-count" aria-hidden="true">%3$d</span><span class="screen-reader-text">%2$s</span></a>',
            esc_url( wc_get_cart_url() ),
            esc_attr( $pubquiz_cart_label ),
            (int) $pubquiz_cart_count
        );
    },
    60
);

/**
 * Footer: replace Storefront's "Built with Storefront" credit line
 * (`storefront_credit`, `storefront_footer` priority 20) with the
 * wordmark, the identity block (PUBQUIZ_FOOTER_IDENTITY above) and the
 * five legal links (spec #142 "Footer and legal block"). The five target
 * pages are created by ticket #144's bootstrap step; until then these
 * links may 404, which is out of scope for this ticket (see the PR body).
 */
add_action(
    'init',
    function () {
        remove_action( 'storefront_footer', 'storefront_credit', 20 );
    }
);

add_action(
    'storefront_footer',
    function () {
        $pubquiz_identity = PUBQUIZ_FOOTER_IDENTITY;
        $pubquiz_links     = array(
            '/voorwaarden/' => __( 'Voorwaarden', 'unieke-pubquiz' ),
            '/privacy/'     => __( 'Privacy', 'unieke-pubquiz' ),
            '/herroeping/'  => __( 'Herroeping', 'unieke-pubquiz' ),
            '/cookies/'     => __( 'Cookies', 'unieke-pubquiz' ),
            '/contact/'     => __( 'Contact', 'unieke-pubquiz' ),
        );

        echo '<div class="pubquiz-footer">';

        printf(
            '<a href="%1$s" class="pubquiz-wordmark pubquiz-footer-wordmark" rel="home">%2$s</a>',
            esc_url( home_url( '/' ) ),
            esc_html( PUBQUIZ_WORDMARK_TEXT )
        );

        echo '<div class="pubquiz-footer-identity">';
        printf( '<span>%s</span>', esc_html( $pubquiz_identity['company_name'] ) );
        printf( '<span>%s</span>', esc_html( $pubquiz_identity['kvk'] ) );
        printf( '<span>%s</span>', esc_html( $pubquiz_identity['btw'] ) );
        printf( '<span>%s</span>', esc_html( $pubquiz_identity['address'] ) );
        printf(
            '<a href="%1$s">%2$s</a>',
            esc_url( 'mailto:' . $pubquiz_identity['email'] ),
            esc_html( $pubquiz_identity['email'] )
        );
        echo '</div>';

        echo '<nav class="pubquiz-footer-links" aria-label="' . esc_attr__( 'Juridisch', 'unieke-pubquiz' ) . '">';
        foreach ( $pubquiz_links as $pubquiz_href => $pubquiz_label ) {
            printf( '<a href="%1$s">%2$s</a>', esc_url( home_url( $pubquiz_href ) ), esc_html( $pubquiz_label ) );
        }
        echo '</nav>';

        echo '</div>';
    },
    20
);

/**
 * Configurator button label (#146, ticket brief "Decisions": "Button
 * label: `Bestellen` via the `woocommerce_product_single_add_to_cart_text`
 * filter ... guarded on `is_front_page() || is_shop()`; that is the only
 * `functions.php` change."). Guarded the same way `archive-product.php`
 * guards which page gets the landing markup, so the plugin's own default
 * text ("Toevoegen aan winkelwagen") keeps showing anywhere else this
 * filter might otherwise run (there is no other selling page today, but
 * the guard costs nothing and matches the template's own condition).
 */
add_filter(
    'woocommerce_product_single_add_to_cart_text',
    function ( $pubquiz_text ) {
        if ( is_front_page() || is_shop() ) {
            return __( 'Bestellen', 'unieke-pubquiz' );
        }
        return $pubquiz_text;
    }
);
