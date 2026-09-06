/**
 * `npm run shop:up` -- idempotently brings the local shop to a state where
 * `npm run shop:order` and `npm run shop:capture` work. Assumes `wp-env
 * start` has already run (the npm script chains it first); this script
 * covers everything wp-env itself cannot express declaratively:
 *   - the Mailpit mail-catcher container (see lib/mailpit.ts)
 *   - the Pubquiz product (created once, reused after)
 *   - the Advanced Product Fields field group on that product (re-applied
 *     every run -- cheap and keeps it in sync with this script)
 *   - the `order.updated` webhook (created once, delivery_url/secret kept
 *     in sync with .env.local on every run)
 *   - the "pubquiz-pipeline" WooCommerce REST API key the deliver module
 *     (#41) uses, written to .env.shop.local (see lib/rest-api-key.ts)
 *
 * WooCommerce, the Advanced Product Fields plugin, and the pubquiz-* mu
 * plugins are installed/activated by wp-env itself per .wp-env.json and
 * need no action here.
 */
import { wpCli, wpCliJson } from "./lib/wp-cli";
import { getOrCreateProductId } from "./lib/product";
import { ensureWebhook } from "./lib/webhook";
import { ensureMailpit } from "./lib/mailpit";
import { ensureRestApiKey } from "./lib/rest-api-key";
import { WP_ENV_PORT } from "./lib/config";

/** Finds the WooCommerce page by slug (e.g. "cart", "checkout") and replaces its content with the given classic shortcode, if it isn't already. */
function applyClassicShortcode(slug: string, shortcode: string): void {
  const ids = wpCliJson<number[]>([
    "post",
    "list",
    "--post_type=page",
    `--name=${slug}`,
    "--field=ID",
    "--posts_per_page=1",
    "--format=json",
  ]);
  if (ids.length === 0) {
    throw new Error(`No WooCommerce "${slug}" page found -- has WooCommerce finished installing?`);
  }
  wpCli(["post", "update", String(ids[0]), `--post_content=${shortcode}`]);
}

function main() {
  const { uiUrl: mailpitUrl } = ensureMailpit();

  const productId = getOrCreateProductId();

  wpCli(["eval-file", "wp-content/mu-plugins/wp-cli-scripts/setup-field-group.php"]);

  // The Advanced Product Fields plugin's free tier only renders its fields
  // (and only accepts them at checkout) through WooCommerce's classic
  // Cart/Checkout shortcodes -- it does not integrate with the Store API, so
  // the default block-based Cart/Checkout pages silently show none of our
  // fields. See shop/README.md ("Interface gaps").
  applyClassicShortcode("cart", "[woocommerce_cart]");
  applyClassicShortcode("checkout", "[woocommerce_checkout]");

  const { deliveryUrl } = ensureWebhook();

  // Rotated on every run (see lib/rest-api-key.ts's docblock for why reuse
  // isn't possible) and written to .env.shop.local -- never printed in full
  // here, since this log is not a secret store.
  ensureRestApiKey();

  console.log("Pubquiz shop is up.");
  console.log(`  Shop:          http://localhost:${WP_ENV_PORT}`);
  console.log(`  Admin:         http://localhost:${WP_ENV_PORT}/wp-admin (admin/password)`);
  console.log(`  Product:       #${productId} (http://localhost:${WP_ENV_PORT}/?p=${productId})`);
  console.log(`  Mail catcher:  ${mailpitUrl}`);
  console.log(`  Webhook:       order.updated -> ${deliveryUrl}`);
  console.log(`  REST API key:  written to .env.shop.local (WOOCOMMERCE_URL/CONSUMER_KEY/CONSUMER_SECRET)`);
  console.log("");
  console.log("Next: npm run shop:order -- --email you@example.com --pick 0=1");
  console.log("      npm run shop:capture");
}

main();
