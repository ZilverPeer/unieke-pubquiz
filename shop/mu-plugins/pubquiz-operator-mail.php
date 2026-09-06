<?php
/**
 * Plugin Name: Pubquiz Operator Mail
 * Description: Mails the shop admin whenever a private WooCommerce order note
 *              starts with the OPERATOR_NOTE_PREFIX used by the worker to
 *              flag a Quiz that could not be generated (spec #36, ticket #37).
 *              Keep the prefix in sync with src/domain/checkout.ts.
 *
 * This is a must-use plugin: it ships with the wp-env setup and, unmodified,
 * with the WordPress container on the VPS later.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * Keep in sync with OPERATOR_NOTE_PREFIX in src/domain/checkout.ts.
 * PHP cannot import the TypeScript constants module, so the value is
 * duplicated here; a mismatch means operator alerts silently stop firing.
 */
const PUBQUIZ_OPERATOR_NOTE_PREFIX = '[pubquiz]';

/**
 * @param int            $comment_id The order note's comment id.
 * @param WC_Order|false $order      The order the note was added to.
 */
function pubquiz_mail_operator_on_note( $comment_id, $order ) {
    $comment = get_comment( $comment_id );
    if ( ! $comment ) {
        return;
    }

    $note = $comment->comment_content;
    if ( 0 !== strpos( $note, PUBQUIZ_OPERATOR_NOTE_PREFIX ) ) {
        return;
    }

    $admin_email = get_option( 'admin_email' );
    $order_id    = is_object( $order ) && method_exists( $order, 'get_id' ) ? $order->get_id() : '';

    $subject = sprintf( '[Pubquiz] Order #%s needs attention', $order_id );
    $body    = sprintf(
        "A private order note starting with \"%s\" was added to order #%s:\n\n%s",
        PUBQUIZ_OPERATOR_NOTE_PREFIX,
        $order_id,
        $note
    );

    wp_mail( $admin_email, $subject, $body );
}
add_action( 'woocommerce_order_note_added', 'pubquiz_mail_operator_on_note', 10, 2 );
