<?php
/**
 * Run via `wp eval-file wp-content/mu-plugins/wp-cli-scripts/create-rest-api-key.php`
 * by scripts/shop/lib/rest-api-key.ts (ensureRestApiKey, called from
 * `npm run shop:up`). Creates a fresh WooCommerce REST API key (read/write)
 * with description "pubquiz-pipeline", deleting any existing key with that
 * description first, and prints the new "consumer_key|consumer_secret" pair
 * once on stdout.
 *
 * WooCommerce's own WP-CLI command set has no `wp wc rest-api-key`/similar
 * command (unlike `wp wc webhook`), and there is no supported way to
 * recover a key's plaintext consumer_key once created -- only its hash
 * (wc_api_hash()) is stored, so a lookup by description can't hand back
 * usable credentials for reuse. Rather than special-case that, this script
 * rotates the credentials on every `shop:up` run instead; see
 * shop/README.md ("REST credentials").
 *
 * Mirrors what WooCommerce's own admin screen does when creating a key
 * (includes/admin/class-wc-admin-api-keys.php / wc_api_hash() in
 * includes/wc-formatting-functions.php): ck_/cs_-prefixed random hex, the
 * key stored hashed, the secret stored as-is.
 */

if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) {
    exit;
}

if ( ! function_exists( 'wc_api_hash' ) ) {
    WP_CLI::error( 'WooCommerce is not active.' );
}

global $wpdb;
$table       = $wpdb->prefix . 'woocommerce_api_keys';
$description = 'pubquiz-pipeline';

$wpdb->delete( $table, array( 'description' => $description ) );

$admin   = get_user_by( 'login', 'admin' );
$user_id = $admin ? $admin->ID : 1;

$consumer_key    = 'ck_' . bin2hex( random_bytes( 20 ) );
$consumer_secret = 'cs_' . bin2hex( random_bytes( 20 ) );

$inserted = $wpdb->insert(
    $table,
    array(
        'user_id'         => $user_id,
        'description'     => $description,
        'permissions'     => 'read_write',
        'consumer_key'    => wc_api_hash( $consumer_key ),
        'consumer_secret' => $consumer_secret,
        'truncated_key'   => substr( $consumer_key, -7 ),
    )
);

if ( false === $inserted ) {
    WP_CLI::error( 'Failed to insert the pubquiz-pipeline REST API key: ' . $wpdb->last_error );
}

WP_CLI::log( $consumer_key . '|' . $consumer_secret );
