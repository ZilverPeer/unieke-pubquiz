<?php
/**
 * Legal identity placeholders -- the single source `functions.php`'s
 * `PUBQUIZ_FOOTER_IDENTITY` constant is built from (footer block, ticket
 * #143) and that `setup-shop.php`'s mail-branding step (ticket #144)
 * `require`s directly by path (`WP_CONTENT_DIR . '/themes/unieke-pubquiz/inc/identity.php'`)
 * for the processing-mail footer text, so the two never drift apart.
 *
 * Keys mirror the fields competitor research
 * (docs/research/2026-09-competitor-analysis.md) named as required: company
 * name, KvK number, BTW-ID, address, contact email. Placeholder values,
 * filled in by the deployment spec.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

return array(
    'company_name' => 'Unieke Pubquiz B.V. (placeholder)',
    'kvk'           => 'KvK 00000000 (placeholder)',
    'btw'           => 'BTW NL000000000B00 (placeholder)',
    'address'       => 'Straatnaam 1, 1000 AA Plaatsnaam (placeholder)',
    'email'         => 'info@uniekepubquiz.nl (placeholder)',
);
