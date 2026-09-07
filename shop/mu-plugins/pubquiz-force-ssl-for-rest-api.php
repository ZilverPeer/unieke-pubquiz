<?php
/**
 * WooCommerce's REST API only performs Basic Auth (consumer key/secret) when
 * `is_ssl()` is true -- see WC_REST_Authentication::authenticate() in
 * class-wc-rest-authentication.php. Over plain HTTP it silently falls through
 * to OAuth 1.0a signing instead, which the deliver module (#41,
 * src/deliver/woocommerce-client.ts) does not implement, so every request
 * was treated as anonymous and rejected with `woocommerce_rest_cannot_view`.
 *
 * This shop only ever runs locally over plain HTTP (shop/README.md), so
 * there is no real TLS termination to trust an X-Forwarded-Proto header
 * from. Instead, for requests under /wp-json/wc/ only, tell WordPress the
 * request is SSL before WooCommerce's REST auth check runs, so Basic Auth
 * works exactly as the deliver module (and CONTEXT.md "Delivery") expects.
 * Scoped to /wp-json/wc/ so nothing else that reads is_ssl() (cookies,
 * admin redirects, etc.) is affected.
 */

if ( isset( $_SERVER['REQUEST_URI'] ) && str_contains( $_SERVER['REQUEST_URI'], '/wp-json/wc/' ) ) {
    $_SERVER['HTTPS'] = 'on';
}
