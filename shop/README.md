# Local shop (ticket #37)

A local WooCommerce shop, run entirely in Docker via `@wordpress/env`, that
lets you place a paid Pubquiz order end-to-end and inspect what the webhook
receiver (#39) and the deliver module (#41) see. Nothing here talks to
Vercel or Supabase; it reads `src/domain/checkout.ts` and
`src/domain/types.ts` for the pinned meta-key/slot constants.

Since ticket #56 the shop is Dutch: the Storefront theme, `nl_NL` site
language, EUR/NL WooCommerce settings, a Dutch product, and a guest checkout
that only asks for a name and an email. See "Dutch storefront" below.

## Commands

| Command | What it does |
| --- | --- |
| `npm run shop:up` | Starts wp-env, starts the Mailpit mail catcher, then runs the entire WordPress-side bootstrap as a single `wp eval-file` call (`setup-shop.php`, see "Single bootstrap"): idempotently activates the Storefront theme, installs the Dutch language, sets WooCommerce's Dutch store settings, renames the Dutch pages, creates/reuses the Pubquiz product, (re)attaches its Advanced Product Fields field group, switches the Cart/Checkout pages to classic shortcodes (see "Interface gaps"), creates/updates the `order.updated` webhook, and creates a fresh WooCommerce REST API key for the deliver module (see "REST credentials"). Prints its own wall-clock time. Safe to re-run any time. |
| `npm run shop:down` | Stops wp-env and the Mailpit container. Data is preserved (see "Reset"). |
| `npm run shop:order -- --email a@b.com [--locale nl] [--difficulty easy] [--mode mixed] [--pick 0=<categoryId>] [--quiz ...]` | Creates a **paid, `processing`** order for the Pubquiz product directly via WP-CLI, with `meta_data` set exactly per `CHECKOUT_META_KEYS`. `--quiz` starts a new line item (multi-quiz order); `--pick <slot>=<id>` may repeat for slots 0-7; `--quantity <n>` sets the current line item's quantity. |
| `npm run shop:capture [-- --out <path>] [-- --port <n>]` | A one-shot HTTP listener (default port 3000) that prints and optionally saves the next webhook delivery it receives, then exits. |

**Windows/PowerShell note:** `npm run shop:order -- --email a@b.com ...` (and
`shop:capture` with flags) breaks under npm 11 on PowerShell -- npm eats the
flags after `--` instead of passing them through to the script, so they never
reach the script's own `argv` parsing. Run the underlying script directly
instead: `npx tsx scripts/shop/place-order.ts --email a@b.com ...` (and
`npx tsx scripts/shop/capture-webhook.ts --out <path>` / `--port <n>` for
`shop:capture`).

## Ports

| Service | Port | URL |
| --- | --- | --- |
| wp-env site | 45330 | http://localhost:45330 (admin: `admin` / `password`) |
| wp-env tests site | 45331 | (used only by `wp-env run tests-cli`, not needed for this ticket) |
| Mailpit web UI | 45332 | http://127.0.0.1:45332 |
| Mailpit SMTP | 45333 | (wp-env's WordPress container connects here) |
| `shop:capture` listener | 3000 | reachable from wp-env's containers as `http://host.docker.internal:3000` |

These were picked to sit outside the Supabase local stack's 45320-45329
range (see `supabase/config.toml`) and Next.js's own dev port 3000 is *not*
in conflict because the two are never run at the same time against the same
port in this ticket's workflow -- `shop:capture` and `next dev` both default
to 3000, so stop one before starting the other, or pass `--port` to
`shop:capture`.

## Typical flow

```sh
npm run shop:up
npm run shop:capture -- --out shop/fixtures/order-updated-processing.json &
npm run shop:order -- --email you@example.com --locale nl --difficulty easy --mode single_category --pick 0=1
# WooCommerce webhooks are delivered async via Action Scheduler/WP-Cron, which
# is pseudo-cron and only runs on real HTTP traffic. A pure WP-CLI order
# update won't kick it by itself in this environment; simplest reliable way
# to fire it locally:
npx wp-env run cli -- wp action-scheduler run --user=admin
```

The capture listener writes headers (including `X-WC-Webhook-Signature`)
and the JSON body to the given `--out` path and exits.

## Mail catcher

**Mailpit**, not Supabase's Inbucket. Supabase's Inbucket (`supabase/config.toml`
`[local_smtp]`, UI on port 45324) only publishes its **web UI** port to the
host -- its SMTP port (1025) is internal to the Supabase Docker network,
which wp-env's WordPress container cannot reach (different Docker network,
started by a different tool). `npm run shop:up` therefore starts a small,
separate `axllent/mailpit` container (`pubquiz-mailpit`), with its SMTP port
published at 45333 (reachable from wp-env's containers via Docker Desktop's
`host.docker.internal`) and its web UI at http://127.0.0.1:45332. All
outgoing `wp_mail()` calls are routed there by
`shop/mu-plugins/pubquiz-mailpit-smtp.php`.

## Single bootstrap (ticket #61)

Every WP-CLI call against the wp-env container costs about 14 seconds on
Windows (0.4s PHP, 4s WordPress bootstrap, 14s once WooCommerce and the
theme are loaded too), because Docker Desktop on Windows serves the
WordPress files through a bind mount. Before this ticket, `scripts/shop/setup.ts`
made about 26 separate `wp` calls (one per theme/language/option/page/
product/webhook/etc. step), which added up to roughly six minutes.

`npm run shop:up` now makes exactly one WP-CLI call for all of that:
`wp eval-file wp-content/mu-plugins/wp-cli-scripts/setup-shop.php
<webhookDeliveryUrl> <webhookSecret>`. That one PHP script does everything
theme activation through the REST API key used to (see "Dutch storefront"
and "REST credentials" below for what each step does) directly against
WordPress/WooCommerce's own PHP APIs -- `switch_theme()`,
`wp_download_language_pack()`/`Language_Pack_Upgrader`, `update_option()`,
`wp_update_post()`, `WC_Product_Simple`, `WC_Webhook` -- rather than
shelling out to `wp` subcommands from inside an already-running `wp
eval-file` process. Every step still reads the current state first and
only writes when something differs, exactly as before; only the number of
WP-CLI round trips changed. The script's only line of STDOUT is one JSON
object (`{"productId":..,"webhookId":..,"deliveryUrl":"..","consumerKey":"..","consumerSecret":".."}`,
parsed by `scripts/shop/lib/setup-result.ts`'s `parseSetupResult()`) -- every
diagnostic message goes to STDERR instead, so wp-env's own output framing
never has to be told apart from actual step output.

`scripts/shop/setup.ts` itself now only does what has to run on the host:
start Mailpit (`lib/mailpit.ts`), make that one `wp eval-file` call
(`lib/wp-cli.ts`), and upsert the returned REST API credentials into
`.env.local` (`lib/env-file.ts`). It prints its own wall-clock time at the
end.

## Dutch storefront (ticket #56)

`npm run shop:up` brings the shop to a Dutch, guest-checkout-ready state,
idempotently, via `shop/mu-plugins/wp-cli-scripts/setup-shop.php` (see
"Single bootstrap" below):

- **Theme.** The Storefront theme (WooCommerce's own free theme, chosen per
  spec #55 "Theme" -- it works with the classic Cart/Checkout shortcodes
  this shop already needs for the Advanced Product Fields plugin, see
  "Plugin choice" below) is installed via `.wp-env.json`'s declarative
  `themes` array (the same idempotent-on-`wp-env start` mechanism the
  `plugins` array already used for WooCommerce and Advanced Product Fields),
  using the plain `https://downloads.wordpress.org/theme/storefront.zip`
  URL rather than a `.latest-stable.zip` one -- wp-env names the extracted
  directory after the zip filename minus `.zip`
  (`node_modules/@wordpress/env/lib/download-sources.js`), so a
  `.latest-stable.zip` URL would extract to
  `wp-content/themes/storefront.latest-stable/` instead of
  `wp-content/themes/storefront/`, same bug already documented below for
  plugins. `setup-shop.php` activates it (`switch_theme()`) only if it isn't
  the active theme already (`get_stylesheet()`).
- **Language.** `setup-shop.php` installs the `nl_NL` core language pack and
  sets it as the site language (`WPLANG`), plus the Dutch translations for
  WooCommerce's and Storefront's own strings, calling WordPress's own
  `wp_download_language_pack()`/`Language_Pack_Upgrader` directly (what `wp
  language ... install` wraps) rather than shelling out to a `wp`
  subcommand -- see "Single bootstrap" below for why. Idempotent by
  checking first: a core pack already in `get_available_languages()`, or a
  plugin/theme pack whose `.mo` file already exists under `WP_LANG_DIR`, is
  never re-downloaded (see "Single bootstrap" for why this replaces `wp
  language core update`'s unconditional refresh).
- **WooCommerce store settings.** `woocommerce_currency=EUR`,
  `woocommerce_default_country=NL`,
  `woocommerce_enable_guest_checkout=yes`,
  `woocommerce_enable_signup_and_login_from_checkout=yes` -- option names
  verified against the installed WooCommerce itself
  (`wp option list --search=woocommerce_*`), not assumed. `setup-shop.php`
  reads each option first and only calls `update_option()` when the value
  differs.
- **Product.** The Pubquiz product's name, short description and
  (placeholder, 14.95 EUR) price are Dutch, set by `setup-shop.php`'s
  `pubquiz_ensure_product()` both at creation and, so a re-run converges an
  already-existing product too, on every subsequent `shop:up`.
- **Pages.** WooCommerce's own install creates its Shop/Cart/Checkout/My
  account pages with English titles and slugs *before* the language switch
  runs -- switching the site language doesn't retitle already-existing
  content, so left alone, every page's `<title>` and Storefront's primary
  navigation (which falls back to listing published pages when no menu is
  assigned, true here) would stay English forever, reruns included.
  `setup-shop.php` renames them in place, by `woocommerce_<page>_page_id`
  option (never by slug, so WooCommerce's own page-id wiring keeps pointing
  at the same post), only if the title or slug differs from the target:
  Shop -> Winkel/`winkel`, Cart -> Winkelwagen/`winkelwagen`, Checkout ->
  Afrekenen/`afrekenen`, My account -> Mijn account/`mijn-account` -- and
  deletes the "Sample Page" WooCommerce leaves behind (otherwise the one
  remaining English entry in the fallback navigation). `setup-shop.php`
  applies the classic Cart/Checkout shortcodes under the new
  (`winkelwagen`/`afrekenen`) slugs right after, in the same run.
- **Guest checkout, minimal fields.** `shop/mu-plugins/pubquiz-checkout-fields.php`
  filters `woocommerce_billing_fields` down to first name, last name and
  email at checkout (`is_checkout()`, true for both the checkout page and
  the wc-ajax checkout submission WooCommerce validates the fields against
  -- see the plugin's own comment) whenever the cart doesn't need shipping
  (true for any cart made up only of virtual products, the Pubquiz product
  included) -- WooCommerce already drops the shipping fields for such a
  cart by itself, this does the same for billing. Scoped to checkout only,
  so My Account -> Addresses still shows every billing field for a
  customer's saved address. Ticks WooCommerce's own "create an account" box
  at checkout to opt into an account; guest checkout otherwise needs nothing
  beyond the three kept fields.
- **The customer notice.** `shop/mu-plugins/pubquiz-customer-notice.php`
  adds a Dutch notice -- "Je quiz wordt gemaakt. Je ontvangt binnen enkele
  minuten een e-mail met de downloadlink." -- to the order-received
  (thank-you) page (`woocommerce_thankyou`) and to the processing-order
  mail (`woocommerce_email_order_details`, filtered to
  `customer_processing_order` only), for any order carrying a
  Pubquiz-configured line item (same `pubquiz_locale` line-item-meta match
  as `pubquiz-hold-processing.php`). An order without a Pubquiz product
  gets neither.

### Key verification (ticket #56): guest checkout, Dutch chrome, the notice

Reproduced against a running `shop:up` (theme active, `nl_NL`, EUR/NL, guest
checkout and account creation on -- read back with `wp theme list
--status=active`, `wp option get WPLANG`, `wp option get
woocommerce_currency`, `wp option get woocommerce_default_country`, `wp
option get woocommerce_enable_guest_checkout`, `wp option get
woocommerce_enable_signup_and_login_from_checkout`):

1. **Dutch chrome, no English leftovers.** `curl` of `/product/pubquiz/`,
   `/winkelwagen/` (after an add-to-cart) and `/afrekenen/` all show a Dutch
   `<title>` ("Pubquiz – digitale download", "Winkelwagen", "Afrekenen"),
   `wp-theme-storefront`/`storefront-primary-navigation` in the body/markup,
   Dutch WooCommerce strings ("Toevoegen aan winkelwagen", "Afrekenen",
   "Voornaam", "Achternaam", "E-mailadres", "Plaats bestelling" on the
   submit button), and a primary navigation of exactly Winkel/Winkelwagen/
   Afrekenen/Mijn account (`wp post list --post_type=page
   --fields=ID,post_title,post_name` shows those four titles/slugs, and no
   "Sample Page") -- no English WooCommerce chrome or leftover default page
   anywhere.
2. **Minimal-fields guest checkout.** The checkout page's rendered billing
   fields are exactly `billing_first_name`, `billing_last_name`,
   `billing_email` (verified by grepping the checkout HTML for
   `id="billing_*"`) -- every other billing field (address, city, postcode,
   country, phone) is gone, per `pubquiz-checkout-fields.php`. Scoped to
   checkout only: `/mijn-account/edit-address/billing/` for a logged-in
   customer still renders every billing field (address, city, postcode,
   country, phone included).
3. **The documented checkout path, name and email only.** Using the same
   add-to-cart -> scrape-nonce -> submit-checkout curl sequence as "Key
   verification (ticket item 3)" below, but with only
   `billing_first_name`, `billing_last_name`, `billing_email` and no address
   fields at all: the order is accepted (`"result":"success"`) and
   `wp wc shop_order get <id> --field=status` reads `processing` -- omitting
   the address fields is not rejected as a missing address.
4. **The notice, on the order-received page and in the mail.** The
   order-received page (the `redirect` URL the checkout AJAX call returns)
   contains "Je quiz wordt gemaakt."; Mailpit's API
   (`curl http://127.0.0.1:45332/api/v1/message/<id>`, message id from
   `curl http://127.0.0.1:45332/api/v1/messages`) shows the same text in the
   customer's "Je bestelling ... is ontvangen!" mail (WooCommerce's Dutch
   subject for its processing-order email).
5. **No notice without a Pubquiz product.** A second, plain product created
   with `wp wc product create` (not the Pubquiz product), bought through the
   same checkout path, reaches `processing` too but its order-received page
   and processing-order mail contain no notice text. The plain product is
   deleted afterwards.
6. **Idempotent setup.** Running `npm run shop:up` twice leaves exactly one
   Pubquiz product (`wp wc product list --field=id`), the same product id,
   Storefront still active, and `nl_NL`/EUR/NL/guest-checkout/signup
   unchanged.

## Plugin choice: Advanced Product Fields (Product Addons) for WooCommerce

wordpress.org slug `advanced-product-fields-for-woocommerce`, by StudioWombat,
free, 1000+ active installs, 96%-rated. Chosen over the handful of other free
WooCommerce add-ons plugins because it supports per-product "local" field
groups (no separate global-group admin screen click-through needed for a
single product), select-type fields with a fixed choice list (needed for the
Category picks), and is actively maintained (tested up to WC 10.9). Attached
via `shop/mu-plugins/wp-cli-scripts/setup-field-group.php`, run by
`npm run shop:up`, which builds the field group directly through the
plugin's own `Field_Groups::raw_json_to_field_group()` builder rather than
clicking through wp-admin -- this keeps `shop:up` scriptable and idempotent.

Fields, one per `CHECKOUT_META_KEYS` entry: `locale`, `difficulty`, `mode`
(all required selects) and `category_1`..`category_8` (optional selects,
one per Item slot). Field **labels** are the literal `CHECKOUT_META_KEYS`
strings (e.g. `pubquiz_locale`) because this plugin's free tier writes each
order line item's `meta_data` as `{label} => {value}`, not `{id} => {value}` --
so the label *is* the wire format. This is documented again, in more detail,
in the setup script's own docblock.

## Key verification (ticket item 3): does the real checkout path write the same keys?

Yes, verified against a real order placed through WooCommerce's actual
checkout code path (not `shop:order`'s direct WP-CLI order creation) using
curl to submit the classic add-to-cart and checkout forms exactly as a
browser would (same endpoints, same fields, same nonce) -- reproducible
without a GUI browser:

```sh
# 1. Add to cart with the plugin's real front-end field names (wapf[field_<id>])
curl -s -c cookies.txt -b cookies.txt \
  -d "quantity=1" -d "add-to-cart=<productId>" -d "wapf_field_groups=<productId>" \
  -d "wapf[field_locale]=en" -d "wapf[field_difficulty]=hard" \
  -d "wapf[field_mode]=single_category" -d "wapf[field_category_1]=7" \
  "http://localhost:45330/product/pubquiz/"

# 2. GET the checkout page, scrape the nonce
curl -s -c cookies.txt -b cookies.txt "http://localhost:45330/checkout/" -o checkout.html
grep -o 'woocommerce-process-checkout-nonce" value="[^"]*"' checkout.html

# 3. Submit checkout with our local test gateway (jumps straight to `processing`)
curl -s -c cookies.txt -b cookies.txt \
  -d "billing_first_name=Via" -d "billing_last_name=Checkout" \
  -d "billing_email=via-checkout@example.com" -d "billing_country=NL" \
  -d "billing_address_1=Teststraat 1" -d "billing_city=Amsterdam" -d "billing_postcode=1000AA" \
  -d "payment_method=pubquiz_test_gateway" \
  -d "woocommerce-process-checkout-nonce=<nonce>" -d "_wp_http_referer=/checkout/" \
  "http://localhost:45330/?wc-ajax=checkout"
```

Result: order reached `processing` immediately (via the local test gateway,
see below), and `wp wc shop_order get <id> --format=json` showed the line
item's `meta_data` as:

```
pubquiz_locale = en
pubquiz_difficulty = hard
pubquiz_mode = single_category
pubquiz_category_1 = 7
_wapf_meta = { ... the plugin's own internal bookkeeping ... }
```

The first four keys match `CHECKOUT_META_KEYS` exactly, byte for byte, with
correct values -- the same shape `shop:order` produces. The extra
`_wapf_meta` key is the plugin's own internal record (underscore-prefixed,
i.e. WooCommerce/WordPress's convention for "protected" meta that a UI or
API consumer is expected to ignore); it needs no special handling by the
future webhook parser (#39).

## Category picks: a known free-tier UX limitation

The plugin's free tier writes a select field's order-item-meta **value**
from the matched choice's *label*, not its slug. To guarantee a Category
pick lands as the exact numeric Category id (never a translated/localised
name, since locale is data per `CONTEXT.md`), each choice's label is set to
the id itself (see `setup-field-group.php`). This means the checkout UI
shows customers a bare number (e.g. "3") instead of a Category name for
these 8 dropdowns. Acceptable for this ticket (only WP-CLI/curl-driven
verification is required); a real storefront would need a paid tier or a
different plugin to show friendly names while still submitting ids.

## Local test payment gateway, and why the order still reaches `processing`

`shop/mu-plugins/pubquiz-test-gateway.php` registers `pubquiz_test_gateway`,
a `WC_Payment_Gateway` that always succeeds and calls the order's standard
`payment_complete()` -- exactly what a real gateway does on success. It does
**not** special-case the resulting status itself. Enabled by default; select
it at checkout, or pass `payment_method=pubquiz_test_gateway` when scripting
a checkout POST as above.

Left alone, WooCommerce's `payment_complete()` jumps straight to
`completed` for an order made up entirely of virtual, downloadable products
(the Pubquiz product is both) -- skipping `processing` entirely, which would
fire the customer's completed-order email with download links before
generation has even started. `shop/mu-plugins/pubquiz-hold-processing.php`
fixes this at the source, for every gateway and every environment
(production included, not just local): it filters
`woocommerce_payment_complete_order_status` to hold any order containing a
Pubquiz-configured line item (matched on the presence of the
`pubquiz_locale` line item meta) at `processing`. The test gateway therefore
exercises the exact path a production gateway would.

`pubquiz-mailpit-smtp.php`, `pubquiz-test-gateway.php`, and
`pubquiz-force-ssl-for-rest-api.php` return early unless
`wp_get_environment_type()` is `local` or `development` (set via
`WP_ENVIRONMENT_TYPE` in `.wp-env.json`); `pubquiz-hold-processing.php` and
`pubquiz-allow-host-webhooks.php` have no such guard since they are meant to
run in production too (`pubquiz-operator-mail.php` and `pubquiz-downloads.php`
are also production code, the former gated only by the presence of a
prefixed private note).

## Operator mail proof

`shop/mu-plugins/pubquiz-operator-mail.php` mails `admin_email` (routed to
Mailpit) whenever a **private** order note's content starts with
`[pubquiz]` (kept in sync by hand with `OPERATOR_NOTE_PREFIX` in
`src/domain/checkout.ts` -- PHP cannot import the TypeScript constant).
Verified via WP-CLI against a fresh order, watching Mailpit's message count
(`curl http://127.0.0.1:45332/api/v1/messages`; clear the inbox first with
`curl -X DELETE http://127.0.0.1:45332/api/v1/messages`):

- `wp wc order_note create <id> --note='\[pubquiz\] operator alert test' --customer_note=false` -> Mailpit count +1, subject `[Pubquiz] Order #<id> needs attention`.
- `wp wc order_note create <id> --note='just a regular note' --customer_note=false` -> Mailpit count unchanged (no mail).
- `wp wc shop_order update <id> --status=completed` -> Mailpit count +1, subject `Your <site> order is now complete` (WooCommerce's built-in completed-order email, proving the mail catcher wiring works end to end, not just our own plugin).

(Escape the brackets with backslashes in `--note` -- passed literally
through wp-env's docker exec chain otherwise, per WP-CLI's own shell
parsing; the escaping does not end up in the stored note text.)

## The webhook

`npm run shop:up` creates (or, on rerun, re-secures/re-activates) a single
`order.updated` webhook named `pubquiz-order-updated`, delivering to
`WOOCOMMERCE_WEBHOOK_URL` (default `http://host.docker.internal:3000/api/webhooks/woocommerce`,
matching `shop:capture`'s default port) with secret `WOOCOMMERCE_WEBHOOK_SECRET`
(default `test-secret` locally; see `.env.example`). WooCommerce signs each
delivery with `X-WC-Webhook-Signature: base64(hmac-sha256(body, secret))`.

Because WP-CLI order creation/update doesn't run through a normal HTTP
request, WordPress's pseudo-cron (which drives Action Scheduler, which
drives webhook delivery) never fires on its own after a scripted order
change. Kick it manually with:

```sh
npx wp-env run cli -- wp action-scheduler run --user=admin
```

The fixture at `shop/fixtures/order-updated-processing.json` was captured
this way, from an order with 3 Category picks (slots 1-3), and contains
the full captured HTTP request: headers (including
`X-WC-Webhook-Signature`) and the JSON body with the order's `line_items[].meta_data`
containing all four keys per Item plus every filled Category slot.

## REST credentials

`npm run shop:up` also creates (or, on rerun, rotates) a WooCommerce REST API
key so the deliver module (#41) can reach this shop over `WOOCOMMERCE_URL` /
`WOOCOMMERCE_CONSUMER_KEY` / `WOOCOMMERCE_CONSUMER_SECRET`. There is no
supported WP-CLI command to create or read back a REST API key, and
WooCommerce stores only a one-way hash of the consumer key (`wc_api_hash()`)
-- the plaintext secret is shown once, at creation, and can never be
recovered. So rather than try to reuse an existing key, `shop:up` deletes any
row with description `pubquiz-pipeline` from the
`wp_woocommerce_api_keys` table and creates a fresh one every run
(`pubquiz_rotate_rest_api_key()` in `setup-shop.php`, folded in from the
former standalone `create-rest-api-key.php` by ticket #61). The key/secret
pair comes back in `setup-shop.php`'s single line of JSON output;
`scripts/shop/lib/env-file.ts` (invoked by `scripts/shop/setup.ts`) upserts
it into `.env.local`. This is safe: nothing in this repo persists the old
key across a `shop:up`, and the worker reads the current one from
`.env.local` each time it starts.

The three values are upserted into the repo root's gitignored `.env.local`
(never printed to the console, never committed) -- the same file Next.js
loads automatically for `next dev`/the worker, and the one the tsx dev
scripts and the vitest integration suite load explicitly via
`scripts/load-env.ts`. One file, no manual copying -- see
`src/deliver/README.md` and the root `README.md` "Environment variables".

## Interface gaps

A few things the brief didn't call out, discovered while wiring this up:

1. **wp-env's `.latest-stable.zip` plugin URLs produce the wrong directory
   name.** `.wp-env.json`'s `plugins` array names the extracted plugin
   directory after the zip filename minus only `.zip`
   (`node_modules/@wordpress/env/lib/download-sources.js`), so
   `woocommerce.latest-stable.zip` installs into
   `wp-content/plugins/woocommerce.latest-stable/`, not `.../woocommerce/`.
   The Advanced Product Fields plugin checks WooCommerce is active with a
   literal string match against `active_plugins` (`woocommerce/woocommerce.php`),
   not `class_exists('WooCommerce')` -- so with the `.latest-stable.zip` URL
   its whole front-end integration silently no-ops (no PHP error, no
   fields, no order meta). Fixed by using the plain
   `https://downloads.wordpress.org/plugin/<slug>.zip` URLs instead (see
   `.wp-env.json`), which extract to the correct slug-named directory.
2. **The free add-ons plugin has no Store API / WooCommerce Blocks
   integration.** It only hooks classic WooCommerce template actions
   (`woocommerce_before_add_to_cart_button`, etc.), so it renders no fields
   at all on the block-based Cart/Checkout pages WooCommerce creates by
   default in a fresh install. `npm run shop:up` therefore switches those
   two pages to the classic `[woocommerce_cart]` / `[woocommerce_checkout]`
   shortcodes, which is required for item 3's "prove the real checkout path
   writes the same keys" acceptance criterion to be testable at all.
3. **`wp wc webhook update` has no `--delivery_url` option** (WooCommerce's
   own native WP-CLI command only exposes `--name`/`--status`/`--topic`/`--secret`
   for updates) -- this used to mean `shop:up` deleted and recreated the
   webhook whenever the configured delivery URL changed. Ticket #61's
   `setup-shop.php` calls `WC_Webhook::set_delivery_url()` directly instead
   (the PHP object itself supports it, only the WP-CLI command doesn't), so
   a delivery-url change now updates the existing webhook in place and its
   id stays stable across `shop:up` runs.

4. **WooCommerce's REST API only performs Basic Auth (consumer key/secret)
   over HTTPS.** `WC_REST_Authentication::authenticate()` calls
   `perform_basic_authentication()` only `if ( is_ssl() )`; over plain HTTP it
   falls through to OAuth 1.0a signing instead, which the deliver module
   (#41) doesn't implement, so every request looked authenticated-but-anonymous
   and every order call failed with `woocommerce_rest_cannot_view` (401) --
   not an "invalid credentials" error, which is what made this one non-obvious.
   Fixed locally with `shop/mu-plugins/pubquiz-force-ssl-for-rest-api.php`,
   which sets `$_SERVER['HTTPS'] = 'on'` for requests under `/wp-json/wc/`
   only, before WooCommerce's REST auth check runs. Gated to `local`/`development`
   like `pubquiz-mailpit-smtp.php` above -- spoofing `is_ssl()` is only safe
   because this shop's plain-HTTP setup is itself local-only; a real
   deployment behind the VPS's HTTPS reverse proxy already has `is_ssl()`
   true and must never load this shim.

5. **`woocommerce_hidden_order_itemmeta` only hides item meta on the
   wp-admin order screen**, not in the customer-facing template
   (`order-details-item.php`) that the order view, the completed-order
   email, and My Account all render through -- that path only skips
   underscore-prefixed keys (`WC_Order_Item::get_formatted_meta_data()`).
   `pubquiz-downloads.php` hides its raw `pubquiz_download_*` meta from the
   customer-facing table via `woocommerce_order_item_get_formatted_meta_data`
   instead (and keeps the admin-only filter too, since that's a real,
   separate view).

`src/domain/checkout.ts` needed **no changes** -- the plugin's label-as-key
behaviour matches `CHECKOUT_META_KEYS` exactly once field labels are set to
those literal strings (see setup-field-group.php).

## Reset

`npm run shop:down` stops (but does not delete) everything; `npm run shop:up`
resumes where you left off. To fully wipe the WordPress database and start
over: `npx wp-env destroy --force` (prompts unless `--force` is given),
then `npm run shop:up` again -- this recreates the product, field group,
gateway, and webhook from scratch. The Mailpit container is unaffected by
`wp-env destroy` (it's managed separately by these scripts); remove it with
`docker rm -f pubquiz-mailpit` if you want a clean mail history along with a
full WordPress reset.
