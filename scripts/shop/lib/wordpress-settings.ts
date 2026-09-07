/**
 * Idempotent WP-CLI settings for ticket #56: the Storefront theme, the
 * Dutch site/plugin/theme language, and the WooCommerce store settings a
 * Dutch guest checkout needs (currency, base country, guest checkout,
 * account creation at checkout). Split out of setup.ts to keep that file to
 * the shop's own resources (product, field group, webhook, REST key).
 *
 * The Storefront theme itself is installed declaratively by `.wp-env.json`'s
 * `themes` array (same idempotent-on-`wp-env start` mechanism as the
 * `plugins` array already used for WooCommerce and Advanced Product
 * Fields) -- this module only activates it and applies the language/store
 * settings wp-env has no declarative field for.
 */
import { wpCli, wpCliJson } from "./wp-cli";
import { STOREFRONT_THEME_SLUG } from "./config";

/** Activates the Storefront theme (installed by `.wp-env.json`'s `themes` array). Re-running `wp theme activate` on an already-active theme is a no-op. */
export function ensureStorefrontTheme(): void {
  wpCli(["theme", "activate", STOREFRONT_THEME_SLUG]);
}

/**
 * Installs and activates the Dutch site language, plus the Dutch
 * translations for WooCommerce and Storefront, and refreshes all installed
 * translations. Every one of these WP-CLI subcommands is itself idempotent
 * (re-running `language ... install` on an already-installed language just
 * reports it as already installed; `--activate` re-sets the same site
 * language option each time).
 */
export function ensureDutchLanguage(): void {
  wpCli(["language", "core", "install", "nl_NL", "--activate"]);
  wpCli(["language", "plugin", "install", "woocommerce", "nl_NL"]);
  wpCli(["language", "theme", "install", STOREFRONT_THEME_SLUG, "nl_NL"]);
  wpCli(["language", "core", "update"]);
}

/**
 * WooCommerce store settings for a Dutch guest checkout (spec #55): EUR,
 * NL, guest checkout on, account creation at checkout on. Option names
 * verified against the installed WooCommerce's own options (`wp option
 * list --search=woocommerce_*`), not assumed. `wp option update` is
 * idempotent by nature -- setting the same value twice leaves the same
 * state.
 */
export function ensureWooCommerceDutchSettings(): void {
  wpCli(["option", "update", "woocommerce_currency", "EUR"]);
  wpCli(["option", "update", "woocommerce_default_country", "NL"]);
  wpCli(["option", "update", "woocommerce_enable_guest_checkout", "yes"]);
  wpCli(["option", "update", "woocommerce_enable_signup_and_login_from_checkout", "yes"]);
}

/**
 * WooCommerce's own WP-CLI/activation flow creates its special pages
 * (Shop/Cart/Checkout/My account) with English titles and slugs *before*
 * `ensureDutchLanguage()` ever runs -- switching the site language does not
 * retitle already-existing content, so without this, every page's <title>
 * and Storefront's primary navigation (which falls back to listing
 * published pages when no menu is assigned -- true here, and true for a
 * fresh WooCommerce install in general) stay English forever, reruns
 * included.
 *
 * Renamed in place by `woocommerce_<page>_page_id` option (never by slug --
 * the slug is what's changing), so WooCommerce's own "which post is the
 * cart/checkout/shop/my-account page" wiring keeps pointing at the same
 * post. Titles are WooCommerce's own nl_NL translations of its default page
 * titles (verified in the shop after `ensureDutchLanguage()`, not guessed).
 */
const DUTCH_PAGES: ReadonlyArray<{ optionKey: string; title: string; slug: string }> = [
  { optionKey: "woocommerce_shop_page_id", title: "Winkel", slug: "winkel" },
  { optionKey: "woocommerce_cart_page_id", title: "Winkelwagen", slug: "winkelwagen" },
  { optionKey: "woocommerce_checkout_page_id", title: "Afrekenen", slug: "afrekenen" },
  { optionKey: "woocommerce_myaccount_page_id", title: "Mijn account", slug: "mijn-account" },
];

/**
 * Renames WooCommerce's Shop/Cart/Checkout/My account pages to their Dutch
 * titles and slugs, and deletes the default "Sample Page" (WooCommerce
 * install leaves it in place; with no menu assigned it would otherwise be
 * the one remaining English entry in Storefront's fallback navigation).
 * Idempotent: renaming a page that already has the target title/slug, or
 * deleting a "Sample Page" that's already gone, both no-op.
 */
export function ensureDutchPages(): void {
  for (const page of DUTCH_PAGES) {
    const id = wpCli(["option", "get", page.optionKey]).stdout.trim();
    if (!id || id === "0") {
      throw new Error(`${page.optionKey} is not set -- has WooCommerce finished installing its pages?`);
    }
    wpCli(["post", "update", id, `--post_title=${page.title}`, `--post_name=${page.slug}`]);
  }

  const samplePageIds = wpCliJson<number[]>([
    "post",
    "list",
    "--post_type=page",
    "--name=sample-page",
    "--field=ID",
    "--posts_per_page=1",
    "--format=json",
  ]);
  if (samplePageIds.length > 0) {
    wpCli(["post", "delete", String(samplePageIds[0]), "--force"]);
  }
}
