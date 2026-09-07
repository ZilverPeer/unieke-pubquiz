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
import { wpCli } from "./wp-cli";
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
