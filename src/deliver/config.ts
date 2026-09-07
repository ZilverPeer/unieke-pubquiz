/**
 * WooCommerce REST API credentials (spec #36, ticket #41). A plain data
 * shape so createDeliverer stays a pure function of its arguments in tests;
 * resolveDelivererConfigFromEnv is the only place that reads process.env,
 * used by the worker's composition root (src/worker/index.ts).
 */
export interface DelivererConfig {
  /** No trailing slash, e.g. "http://localhost:45330". */
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
}

const REQUIRED_ENV_VARS = ["WOOCOMMERCE_URL", "WOOCOMMERCE_CONSUMER_KEY", "WOOCOMMERCE_CONSUMER_SECRET"] as const;

/**
 * Reads WOOCOMMERCE_URL / WOOCOMMERCE_CONSUMER_KEY / WOOCOMMERCE_CONSUMER_SECRET
 * (see README.md and .env.example). Throws listing every variable still
 * missing, rather than failing on the first one, so a half-configured
 * environment is easy to diagnose in one go.
 */
export function resolveDelivererConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DelivererConfig {
  const missing = REQUIRED_ENV_VARS.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`deliver: missing environment variable(s): ${missing.join(", ")}`);
  }

  return {
    baseUrl: env.WOOCOMMERCE_URL as string,
    consumerKey: env.WOOCOMMERCE_CONSUMER_KEY as string,
    consumerSecret: env.WOOCOMMERCE_CONSUMER_SECRET as string,
  };
}
