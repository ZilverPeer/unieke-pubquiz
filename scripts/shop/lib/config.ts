/**
 * Shared configuration for the local shop scripts (ticket #37).
 *
 * Category ids are hardcoded from `supabase/seed.sql` (the seed is the
 * single source of truth) in
 * shop/mu-plugins/wp-cli-scripts/setup-field-group.php, which is PHP and so
 * cannot import this module. See shop/README.md.
 */

export const WP_ENV_PORT = 45330;
export const WP_ENV_TESTS_PORT = 45331;

export const MAILPIT_CONTAINER = "pubquiz-mailpit";
export const MAILPIT_UI_PORT = 45332;
export const MAILPIT_SMTP_PORT = 45333;
export const MAILPIT_IMAGE = "axllent/mailpit:latest";

export const PUBQUIZ_PRODUCT_SLUG = "pubquiz";
/** Dutch product name and short description (ticket #56); the placeholder price is set on the product itself. */
export const PUBQUIZ_PRODUCT_NAME = "Pubquiz – digitale download";
export const PUBQUIZ_PRODUCT_SHORT_DESCRIPTION =
  "Een kant-en-klare pubquiz om zelf te presenteren: quizmasterscript, beeldronde, antwoordenblad en muziekronde, direct na aankoop per download.";
/** Placeholder price (ticket #56); the real pricing model is out of scope for spec #55. */
export const PUBQUIZ_PRODUCT_PRICE = "14.95";

/** wp-env's plugin-URL directory-naming bug (see shop/README.md "Interface gaps") applies to themes too, so this uses the plain download URL, not `storefront.latest-stable.zip`. */
export const STOREFRONT_THEME_SLUG = "storefront";

export const TEST_GATEWAY_ID = "pubquiz_test_gateway";

export const WEBHOOK_NAME = "pubquiz-order-updated";
export const WEBHOOK_TOPIC = "order.updated";
/** Default target when WOOCOMMERCE_WEBHOOK_URL is not set in the environment. */
export const DEFAULT_WEBHOOK_URL = "http://host.docker.internal:3000/api/webhooks/woocommerce";

export const CAPTURE_PORT = 3000;
