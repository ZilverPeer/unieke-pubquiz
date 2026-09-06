<?php
/**
 * Plugin Name: Pubquiz Mailpit SMTP
 * Description: Routes all outgoing wp_mail() through the local Mailpit
 *              catcher container instead of trying (and failing) to send
 *              real mail from the wp-env WordPress container.
 *
 * Supabase's own mail catcher (Inbucket, UI on http://127.0.0.1:45324) only
 * publishes its web UI port to the host; its SMTP port (1025) is internal to
 * the Supabase Docker network. wp-env's WordPress container lives on a
 * different Docker network and cannot reach it. `npm run shop:up` therefore
 * starts a small, separate `axllent/mailpit` container
 * (see scripts/shop/setup.ts) reachable from inside the WordPress container
 * via Docker Desktop's `host.docker.internal`, with its SMTP port published
 * to the host at 45333 and its web UI at http://127.0.0.1:45332.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

// Never redirect real mail to Mailpit outside local development.
if ( ! in_array( wp_get_environment_type(), [ 'local', 'development' ], true ) ) {
    return;
}

// wp_mail()'s default From address ("wordpress@" + server hostname, e.g.
// "wordpress@localhost") fails PHPMailer's own address syntax check (no TLD)
// inside the wp-env container -- and wp_mail() sets the From address via
// these filters *before* firing 'phpmailer_init', so the fix has to live
// here rather than on the phpmailer object itself.
add_filter( 'wp_mail_from', fn () => 'wordpress@pubquiz.local' );
add_filter( 'wp_mail_from_name', fn () => 'Pubquiz Shop' );

add_action(
    'phpmailer_init',
    function ( $phpmailer ) {
        $phpmailer->isSMTP();
        $phpmailer->Host        = 'host.docker.internal';
        $phpmailer->Port        = 45333;
        $phpmailer->SMTPAuth    = false;
        $phpmailer->SMTPSecure  = '';
        $phpmailer->SMTPAutoTLS = false;
    }
);
