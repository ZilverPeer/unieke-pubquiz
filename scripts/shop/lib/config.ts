/**
 * Shared configuration for the local shop scripts (ticket #37).
 *
 * Since ticket #57, Category ids and Dutch names come from the running
 * Supabase stack's `nl` Category translations (scripts/shop/lib/categories.ts),
 * not a hardcoded list -- see shop/README.md.
 */

export const WP_ENV_PORT = 45330;
export const WP_ENV_TESTS_PORT = 45331;

export const MAILPIT_CONTAINER = "pubquiz-mailpit";
export const MAILPIT_UI_PORT = 45332;
export const MAILPIT_SMTP_PORT = 45333;
export const MAILPIT_IMAGE = "axllent/mailpit:latest";

/**
 * The product slug, name, short description and placeholder price
 * (ticket #56), the Storefront theme slug, and the webhook name/topic used
 * to live here too -- since ticket #61 (single-bootstrap `shop:up`) those
 * are set only in shop/mu-plugins/wp-cli-scripts/setup-shop.php, the single
 * place that creates/converges them, and pinned there by
 * src/domain/shop-fixture.test.ts. `PUBQUIZ_PRODUCT_SLUG` stays here because
 * scripts/shop/lib/product.ts (used by `shop:order`) still needs it to look
 * the product up by slug.
 */
export const PUBQUIZ_PRODUCT_SLUG = "pubquiz";

export const TEST_GATEWAY_ID = "pubquiz_test_gateway";

/** Default target when WOOCOMMERCE_WEBHOOK_URL is not set in the environment. */
export const DEFAULT_WEBHOOK_URL = "http://host.docker.internal:3000/api/webhooks/woocommerce";

export const CAPTURE_PORT = 3000;
