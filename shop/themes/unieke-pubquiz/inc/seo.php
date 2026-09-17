<?php
/**
 * Unieke Pubquiz child theme -- front-page SEO basics (ticket #145, spec
 * #142 "SEO basics"): page title, meta description and Open Graph tags.
 *
 * `wp_head` actions are behaviour, not look, so spec #142's rule ("the
 * theme owns the look, must-use plugins own behaviour") would normally put
 * this in a plugin -- but it's inseparable from the front-page template
 * this ticket owns (only the front page carries it, guarded on
 * `is_front_page()`) and the ticket's file ownership excludes touching
 * `functions.php` (#143/#144), so it lives as its own theme include,
 * `require_once`d from the front-page template before `get_header()`
 * (ticket brief, "SEO on the front page only").
 *
 * No SEO plugin (spec #142 "Assets and tooling" / "SEO basics" decision).
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

define( 'PUBQUIZ_SEO_TITLE', 'Unieke Pubquiz: een unieke pubquiz, in minuten gegenereerd' );
define(
    'PUBQUIZ_SEO_DESCRIPTION',
    'Een complete, unieke pubquiz -- als PDF en muziekronde-MP3, speciaal voor jou samengesteld. Kies je categorieën, moeilijkheid en taal; je krijgt nooit dezelfde vraag twee keer.'
);

/** Front-page-only document title -- everywhere else keeps WordPress's own generated title. */
add_filter(
    'pre_get_document_title',
    function ( $pubquiz_title ) {
        if ( ! is_front_page() ) {
            return $pubquiz_title;
        }
        return PUBQUIZ_SEO_TITLE;
    }
);

/** Front-page-only meta description and Open Graph tags. */
add_action(
    'wp_head',
    function () {
        if ( ! is_front_page() ) {
            return;
        }

        printf( '<meta name="description" content="%s">' . "\n", esc_attr( PUBQUIZ_SEO_DESCRIPTION ) );
        printf( '<meta property="og:title" content="%s">' . "\n", esc_attr( PUBQUIZ_SEO_TITLE ) );
        printf( '<meta property="og:description" content="%s">' . "\n", esc_attr( PUBQUIZ_SEO_DESCRIPTION ) );
        printf( '<meta property="og:type" content="website">' . "\n" );
        printf( '<meta property="og:image" content="%s">' . "\n", esc_url( get_stylesheet_directory_uri() . '/assets/wordmark.png' ) );
        printf( '<meta property="og:url" content="%s">' . "\n", esc_url( home_url( '/' ) ) );
    }
);
