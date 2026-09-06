/**
 * Shared configuration for the local shop scripts (ticket #37).
 *
 * Category ids and Dutch names are hardcoded here from `supabase/seed.sql`
 * (the seed is the single source of truth; this list must be updated by
 * hand if the seed's 8 Categories ever change). See shop/README.md.
 */

export const CATEGORIES: ReadonlyArray<{ id: number; nl: string }> = [
  { id: 1, nl: "Sport" },
  { id: 2, nl: "Geschiedenis" },
  { id: 3, nl: "Muziek" },
  { id: 4, nl: "Aardrijkskunde" },
  { id: 5, nl: "Wetenschap" },
  { id: 6, nl: "Film en TV" },
  { id: 7, nl: "Literatuur" },
  { id: 8, nl: "Algemene Kennis" },
];

export const WP_ENV_PORT = 45330;
export const WP_ENV_TESTS_PORT = 45331;

export const MAILPIT_CONTAINER = "pubquiz-mailpit";
export const MAILPIT_UI_PORT = 45332;
export const MAILPIT_SMTP_PORT = 45333;
export const MAILPIT_IMAGE = "axllent/mailpit:latest";

export const PUBQUIZ_PRODUCT_SLUG = "pubquiz";
export const PUBQUIZ_PRODUCT_NAME = "Pubquiz";

export const TEST_GATEWAY_ID = "pubquiz_test_gateway";

export const WEBHOOK_NAME = "pubquiz-order-updated";
export const WEBHOOK_TOPIC = "order.updated";
/** Default target when WOOCOMMERCE_WEBHOOK_URL is not set in the environment. */
export const DEFAULT_WEBHOOK_URL = "http://host.docker.internal:3000/api/webhooks/woocommerce";

export const CAPTURE_PORT = 3000;
