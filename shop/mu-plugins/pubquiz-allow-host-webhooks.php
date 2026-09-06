<?php
/**
 * Plugin Name: Pubquiz Allow Docker Host Webhooks
 * Description: Lets WooCommerce webhook deliveries (and any other outbound
 *              wp_safe_remote_* request) reach http://host.docker.internal,
 *              which is otherwise rejected by WordPress's SSRF guard in
 *              wp_http_validate_url() because host.docker.internal resolves
 *              to a private/reserved IP address from inside the wp-env
 *              containers (Docker Desktop's host gateway). This only matters
 *              for local development: in production the webhook target is a
 *              real public URL and this filter never triggers.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

add_filter(
    'http_request_host_is_external',
    function ( $is_external, $host ) {
        if ( 'host.docker.internal' === $host ) {
            return true;
        }
        return $is_external;
    },
    10,
    2
);

// wp_http_validate_url() also rejects non-standard ports (only 80/443/8080
// are safe by default) even once the host itself is allowed above -- the
// webhook capture listener (scripts/shop/capture-webhook.ts) runs on 3000.
add_filter(
    'http_allowed_safe_ports',
    function ( $ports, $host ) {
        if ( 'host.docker.internal' === $host ) {
            $ports[] = 3000;
        }
        return $ports;
    },
    10,
    2
);
