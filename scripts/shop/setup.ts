/**
 * `npm run shop:up` -- idempotently brings the local shop to a state where
 * `npm run shop:order` and `npm run shop:capture` work. Assumes `wp-env
 * start` has already run (the npm script chains it first).
 *
 * Since ticket #61 ("single-bootstrap shop:up"), the entire WordPress side
 * of this -- theme, language, WooCommerce store settings, Dutch page
 * renames, the Pubquiz product, the Advanced Product Fields field group,
 * the classic Cart/Checkout shortcodes, the `order.updated` webhook, and a
 * fresh REST API key -- runs as ONE `wp eval-file` call against
 * shop/mu-plugins/wp-cli-scripts/setup-shop.php, instead of about 26
 * separate WP-CLI invocations. Each WP-CLI call costs roughly 14 seconds
 * against this container on Windows bind mounts, so this cut a ~6 minute
 * `shop:up` to well under 90 seconds. See shop/README.md "Single bootstrap".
 *
 * This file now only does what has to run on the host: the Mailpit
 * mail-catcher container (see lib/mailpit.ts), running that one eval-file
 * call and parsing its single line of JSON output (parseSetupResult, in
 * lib/setup-result.ts so it can be unit-tested without booting the whole
 * shop), and upserting the returned REST API credentials into .env.local.
 */
import "../load-env";
import { wpCli } from "./lib/wp-cli";
import { ensureMailpit } from "./lib/mailpit";
import { parseSetupResult, type SetupResult } from "./lib/setup-result";
import { upsertRestApiCredentials } from "./lib/env-file";
import { DEFAULT_WEBHOOK_URL, WP_ENV_PORT } from "./lib/config";

const SETUP_SCRIPT_PATH = "wp-content/mu-plugins/wp-cli-scripts/setup-shop.php";

function runSetupShop(): SetupResult {
  const deliveryUrl = process.env.WOOCOMMERCE_WEBHOOK_URL ?? DEFAULT_WEBHOOK_URL;
  const secret = process.env.WOOCOMMERCE_WEBHOOK_SECRET ?? "test-secret";

  const { stdout } = wpCli(["eval-file", SETUP_SCRIPT_PATH, deliveryUrl, secret]);
  return parseSetupResult(stdout);
}

function main() {
  const startedAt = Date.now();

  const { uiUrl: mailpitUrl } = ensureMailpit();

  const result = runSetupShop();

  // Rotated on every run (see setup-shop.php's docblock for why reuse isn't
  // possible) and upserted into .env.local -- never printed in full here,
  // since this log is not a secret store.
  upsertRestApiCredentials({
    url: `http://localhost:${WP_ENV_PORT}`,
    consumerKey: result.consumerKey,
    consumerSecret: result.consumerSecret,
  });

  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log("Pubquiz shop is up.");
  console.log(`  Shop:          http://localhost:${WP_ENV_PORT}`);
  console.log(`  Admin:         http://localhost:${WP_ENV_PORT}/wp-admin (admin/password)`);
  console.log(`  Product:       #${result.productId} (http://localhost:${WP_ENV_PORT}/?p=${result.productId})`);
  console.log(`  Mail catcher:  ${mailpitUrl}`);
  console.log(`  Webhook:       order.updated -> ${result.deliveryUrl}`);
  console.log(`  REST API key:  upserted into .env.local (WOOCOMMERCE_URL/CONSUMER_KEY/CONSUMER_SECRET)`);
  console.log("");
  console.log("Next: npm run shop:order -- --email you@example.com --pick 0=1");
  console.log("      npm run shop:capture");
  console.log("");
  console.log(`shop:up finished in ${elapsedSeconds}s (setup.ts's own work, after "wp-env start").`);
}

main();
