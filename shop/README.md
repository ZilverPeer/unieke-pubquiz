# Local shop (ticket #37)

A local WooCommerce shop, run entirely in Docker via `@wordpress/env`, that
lets you place a paid Pubquiz order end-to-end and inspect what the webhook
receiver (#39) and the deliver module (#41) see. Nothing here talks to
Vercel; it reads `src/domain/checkout.ts` and `src/domain/types.ts` for the
pinned meta-key/slot constants. Since ticket #57, `npm run shop:up` also
reads the running local Supabase stack's `nl` Category names -- see
"Category names: the Supabase stack, not a hardcoded list" below; **the
Supabase stack must be running and seeded before `shop:up`**
(`npx supabase start && npm run db:reset`, see `docs/runbook-local-loop.md`).

Since ticket #56 the shop is Dutch: the Storefront theme, `nl_NL` site
language, EUR/NL WooCommerce settings, a Dutch product, and a guest checkout
that only asks for a name and an email. See "Dutch storefront" below.

## Commands

| Command | What it does |
| --- | --- |
| `npm run shop:up` | Reads the running Supabase stack's `nl` Category names (see "Category names" below; fails fast if the stack isn't up), starts wp-env, starts the Mailpit mail catcher, starts the cron ticker container (see "The webhook" below), then runs the entire WordPress-side bootstrap as a single `wp eval-file` call (`setup-shop.php`, see "Single bootstrap"): idempotently activates the Storefront theme, installs the Dutch language, sets WooCommerce's Dutch store settings, renames the Dutch pages, creates/reuses the Pubquiz product, (re)attaches its Advanced Product Fields field group (Dutch labels, Category choices from the Supabase stack), switches the Cart/Checkout pages to classic shortcodes (see "Interface gaps"), creates/updates the `order.updated` webhook, and creates a fresh WooCommerce REST API key for the deliver module (see "REST credentials"). Prints its own wall-clock time. Safe to re-run any time. |
| `npm run shop:down` | Stops wp-env, the Mailpit container, and the cron ticker container. Data is preserved (see "Reset"). |
| `npm run shop:order -- --email a@b.com [--locale nl] [--difficulty easy] [--pick <categoryId>] [--quiz ...]` | Creates a **paid, `processing`** order for the Pubquiz product directly via WP-CLI, with `meta_data` set exactly per `CHECKOUT_META_KEYS`. `--quiz` starts a new line item (multi-quiz order); `--pick <id>` may repeat, order preserved, up to 8 times, distinct ids; `--quantity <n>` sets the current line item's quantity. |
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
npm run shop:order -- --email you@example.com --locale nl --difficulty easy --pick 1
# WooCommerce webhooks are delivered async via Action Scheduler/WP-Cron; the
# cron ticker container shop:up started ticks it automatically within a few
# seconds -- no manual step needed (see "The webhook" below).
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
<webhookDeliveryUrl> <webhookSecret> <base64CategoriesJson>` (the third
argument since ticket #57 -- see "Category names" below). That one PHP script does everything
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
  `woocommerce_enable_signup_and_login_from_checkout=yes`,
  `woocommerce_enable_reviews=no` (spec 3c, #83: no Beoordelingen tab or
  star rating anywhere in the shop) -- option names verified against the
  installed WooCommerce itself (`wp option list --search=woocommerce_*`),
  not assumed. `setup-shop.php` reads each option first and only calls
  `update_option()` when the value differs.
- **Product.** The Pubquiz product's name, short description and
  (placeholder, 14.95 EUR) price are Dutch, set by `setup-shop.php`'s
  `pubquiz_ensure_product()` both at creation and, so a re-run converges an
  already-existing product too, on every subsequent `shop:up`. Since spec 3c
  (#83) the product is also `reviews_allowed=false` (no per-product review
  form) and `sold_individually=true` -- no quantity box on the product page
  or in the cart, and adding an identical configuration a second time is
  refused with WooCommerce's own message (a cart line is keyed on the
  product plus its field values, so a *different* configuration still
  becomes a second line, and a multi-Quiz order stays possible).
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
- **Front page: Winkel visible, no coming-soon placeholder (tickets #68/#70).**
  A fresh WooCommerce install turns on "coming soon" mode
  (`woocommerce_coming_soon` = `yes`) and leaves the site's front page as
  WordPress's own default blog listing, whose only post is the default
  "Hello world!" one -- a logged-out visitor at `/` saw neither the shop nor
  its product. `setup-shop.php` sets `woocommerce_coming_soon` = `no`,
  `show_on_front` = `page` with `page_on_front` = Winkel's page id
  (`wc_get_page_id( 'shop' )`, so it keeps tracking the Winkel page through
  the rename above), and trashes post id 1 ("Hello world!") if it exists and
  isn't already trashed -- idempotently, like every other option write here.
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

## Chrome (ticket #70)

The shop is a single-product, one-page storefront: there is nothing for a
primary navigation menu, a breadcrumb trail or a blog sidebar to point at,
and the footer widget area and the mobile "handheld" footer bar just repeat
shortcuts the header already has. `shop/mu-plugins/pubquiz-storefront-chrome.php`
removes each of these Storefront/WooCommerce actions (by exact callback and
priority, read from the installed theme's own `inc/storefront-template-hooks.php`
and `inc/woocommerce/storefront-woocommerce-template-hooks.php`) on `init`,
so a fresh instance and a re-run of an existing one both converge to the
same bare header:

- `storefront_secondary_navigation`, `storefront_primary_navigation_wrapper`,
  `storefront_primary_navigation` and `storefront_primary_navigation_wrapper_close`
  from `storefront_header` -- no primary menu.
- `woocommerce_breadcrumb` (there is no `storefront_breadcrumb` function in
  this theme -- WooCommerce's own breadcrumb callback is what
  `storefront_before_content` actually runs) -- no breadcrumb trail.
- `storefront_get_sidebar` from `storefront_sidebar` -- no sidebar
  (`id="secondary"`).
- `storefront_footer_widgets` and `storefront_handheld_footer_bar` from
  `storefront_footer` -- no footer widgets, no mobile footer bar.

What's left in the header: the logo/site branding, the cart icon
(`storefront_header_cart`, unchanged), and one thing this plugin adds --a
person-outline SVG link to `wc_get_page_permalink( 'myaccount' )` with
visually-hidden "Mijn account" text, hooked onto `storefront_header` at
priority 61 (right after the cart's 60).

**Full-width content.** `.content-area` (`#primary`)'s own CSS
(`style.css`) only spans 100% width with a `storefront-full-width-content`
class on `<body>`; without it, it stays at 73.9%, leaving a blank gap where
the (now unrendered) sidebar used to sit. Storefront's own `body_class`
filter (`class-storefront.php`) adds that class automatically, but only
when `is_active_sidebar( 'sidebar-1' )` is false -- checked empirically
against a running instance (`wp widget list sidebar-1`) and it is *not*
false: WordPress's own default widgets (Search, Recent Posts, Recent
Comments, Archives, Categories) land in `sidebar-1` automatically on first
theme activation and stay there, unused, even though the sidebar itself
never renders. `pubquiz-storefront-chrome.php` therefore adds
`storefront-full-width-content` to `body_class` itself, unconditionally,
rather than relying on Storefront's own check or emptying the sidebar
(which would only hold as long as those default widgets never came back,
e.g. after a theme switch). Verified against a running `shop:up`:
`curl http://localhost:45330/` shows `storefront-full-width-content` on
`<body>` and no `id="secondary"` anywhere in the page.

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

Three fields, all visible (ticket #72): `locale` (select, Taal, required,
Nederlands preselected), `difficulty` (select, Moeilijkheid, required,
Gemengd preselected), and `categories` (**checkboxes**, Categorieën, not
required -- one choice per `nl` Category name, none preselected, with the
description "Zonder keuze krijgt elke ronde een willekeurige categorie.
Kies categorieën als je ze in je quiz wilt."). The eight `category_1`..
`category_8` selects and the `mode` select from before this ticket are gone
-- see CONTEXT.md "Quiz" for the cycle rule, and "Cap of 8" below for why
`categories` has no plugin-level maximum. Field
**ids** stay `locale`/`difficulty`/`categories`; field and choice **labels**
are readable Dutch text (Taal/Moeilijkheid/Categorieën; Nederlands/Engels;
Makkelijk/Gemiddeld/Moeilijk/Gemengd; each Category's `nl` name) -- see
"Readable Dutch options and the label-to-key bridge" below for why that
doesn't break the webhook wire format.

In the browser (spec 3c, #83), `shop/mu-plugins/pubquiz-category-dropdown.php`
turns the `categories` checkbox group into a searchable multi-select
dropdown with removable chips (a vendored copy of Tom Select, see "Searchable
Categorieën dropdown" below); a plain `curl` of the product page still shows
the underlying checkbox inputs -- the dropdown is a client-side enhancement
of the same field, not a replacement for it.

The `categories` field's description text renders through this plugin's own
free-tier template (`views/frontend/field-group.php` calls
`Html::field_description($field)`, which prints `$field->description`
verbatim when set) -- no fallback rendering hook was needed.

### Cap of 8

The free tier's `checkboxes` field type has no maximum-selection setting --
verified against the installed plugin's own source
(`includes/classes/class-field-groups.php`'s `raw_json_to_field_group()`
accepts a generic `maximum` option on any field, but
`includes/classes/class-html.php` only ever reads `$field->options['maximum']`
to set the `number` field type's HTML `max` attribute; nothing reads it for
`checkboxes`). So the cap is enforced server-side instead:
`pubquiz-checkout-meta.php` hooks `woocommerce_add_to_cart_validation` and
rejects an add-to-cart whose `wapf[field_categories][]` POST array has more
than 8 entries, with the Dutch notice "Kies maximaal 8 categorieën." (`wc_add_notice(..., 'error')`,
`return false`); 0 picks always passes. The cap number and its notice text
are each a single PHP constant (`PUBQUIZ_MAX_CATEGORY_PICKS`,
`PUBQUIZ_MAX_CATEGORY_PICKS_MESSAGE`, `pubquiz-checkout-meta.php`) -- the
dropdown's own client-side cap (below) reads both from a data attribute
printed from these same constants, so server and browser can't drift apart.

**Pick order.** A browser always serialises a checked group of same-named
inputs in DOM order, i.e. the order the choices were rendered in --
`setup-field-group.php`'s choice order, which is Category id order (the
order `$pubquiz_categories` lists them in, from `loadDutchCategories()`).
So "pick order" -- what `pubquiz_category_1..N` and the sampler's cycle
rule (CONTEXT.md "Quiz") both use -- is Category id order among the
customer's checked boxes, not click order.

### Searchable Categorieën dropdown (spec 3c, #83)

`shop/mu-plugins/pubquiz-category-dropdown.php` enqueues a vendored copy of
[Tom Select](https://tom-select.js.org/) (`shop/assets/tom-select/`, one JS
and one CSS file, version and licence in that directory's own `VERSION` and
`LICENSE` files; no CDN) on the single product page, then prints a small
inline script that, once the DOM is ready: builds a `<select multiple>`
from the `categories` checkbox group's own checkboxes (label = choice
label, value = choice slug, in DOM order -- Category id order, "Pick order"
above), hides the checkbox group, and initialises Tom Select on the
`<select>` with the remove-button plugin (chips) and a `maxItems` read from
a `data-pubquiz-max-picks` attribute the plugin prints (from
`PUBQUIZ_MAX_CATEGORY_PICKS`, see "Cap of 8" above). Every selection change
mirrors back onto the (now hidden) checkboxes' `checked` state, so the form
still posts `wapf[field_categories][]` exactly as before -- the meta bridge,
the server-side cap, the fixture and the parser are all untouched. A ninth
pick shows the same Dutch cap message (`data-pubquiz-max-picks-message`,
from `PUBQUIZ_MAX_CATEGORY_PICKS_MESSAGE`) next to the picker, before the
customer ever clicks "Toevoegen aan winkelwagen". **Without JavaScript**
nothing here runs: the checkbox group stays visible and posts as it always
has -- this is also what a plain `curl` of the product page sees. The
description sentence below the picker is unchanged.

The assets are served through a second `wp-env` mapping,
`wp-content/mu-plugins/assets` -> `./shop/assets` (`.wp-env.json`), a
subdirectory of the existing mu-plugins mount, so `plugins_url()` (which
resolves relative to `WPMU_PLUGIN_DIR` for a file in `wp-content/mu-plugins`)
finds them without a new top-level mount.

## Key verification (ticket item 3, updated by #72): does the real checkout path write the same keys?

Yes, verified against a real order placed through WooCommerce's actual
checkout code path (not `shop:order`'s direct WP-CLI order creation) using
curl to submit the classic add-to-cart and checkout forms exactly as a
browser would (same endpoints, same fields, same nonce) -- reproducible
without a GUI browser. The `categories` field is a checkbox group, so its
form field name is `wapf[field_categories][]` (an array, one entry per
checked box, per `views/frontend/fields/checkboxes.php`), unlike the
single-value `wapf[field_<id>]` names `locale`/`difficulty` use:

```sh
# 1. Add to cart with the plugin's real front-end field names
curl -s -c cookies.txt -b cookies.txt \
  -d "quantity=1" -d "add-to-cart=<productId>" -d "wapf_field_groups=<productId>" \
  -d "wapf[field_locale]=en" -d "wapf[field_difficulty]=hard" \
  -d "wapf[field_categories][]=1" -d "wapf[field_categories][]=3" \
  "http://localhost:45330/product/pubquiz/"

# 2. GET the checkout page, scrape the nonce
curl -s -c cookies.txt -b cookies.txt "http://localhost:45330/afrekenen/" -o checkout.html
grep -o 'woocommerce-process-checkout-nonce" value="[^"]*"' checkout.html

# 3. Submit checkout with our local test gateway (jumps straight to `processing`)
curl -s -c cookies.txt -b cookies.txt \
  -d "billing_first_name=Via" -d "billing_last_name=Checkout" \
  -d "billing_email=via-checkout@example.com" -d "billing_country=NL" \
  -d "billing_address_1=Teststraat 1" -d "billing_city=Amsterdam" -d "billing_postcode=1000AA" \
  -d "payment_method=pubquiz_test_gateway" \
  -d "woocommerce-process-checkout-nonce=<nonce>" -d "_wp_http_referer=/afrekenen/" \
  "http://localhost:45330/?wc-ajax=checkout"
```

(the Cart/Checkout pages are `/winkelwagen/`/`/afrekenen/`, not the English
`/cart/`/`/checkout/` slugs, since ticket #56's Dutch page renames -- see
"Dutch storefront" above.)

Result: order reached `processing` immediately (via the local test gateway,
see below), and `wp wc shop_order get <id> --format=json` showed the line
item's `meta_data` as:

```
Taal = Engels
Moeilijkheid = Moeilijk
Categorieën = Sport, Literatuur
_wapf_meta = {
  "locale":     { "id": "locale", "label": "Taal", "value": "Engels", "raw": "en" },
  "difficulty": { "id": "difficulty", "label": "Moeilijkheid", "value": "Moeilijk", "raw": "hard" },
  "categories": { "id": "categories", "label": "Categorieën", "value": "Sport, Literatuur", "raw": ["1", "3"] }
}
pubquiz_locale = en
pubquiz_difficulty = hard
pubquiz_category_1 = 1
pubquiz_category_2 = 3
```

**The `categories` field's `_wapf_meta` `raw` value is an array of Category
id slugs, one per checked box, in the customer's check order** -- not a
joined string, unlike every other field type here. Verified directly
against the installed plugin's own
`includes/controllers/class-product-controller.php`'s `to_cart_fields()`:
`'raw' => is_string($raw_value) ? sanitize_textarea_field($raw_value) :
array_map('sanitize_textarea_field', $raw_value)` -- checkbox inputs post
`wapf[field_categories][]`, an array, so `$raw_value` is only ever a string
here when nothing is checked, and in that case `create_order_line_item()`
never adds a `categories` entry to `_wapf_meta` at all (it only adds an
entry when `!empty($field['value'])`). `pubquiz-checkout-meta.php`'s
`pubquiz_write_category_picks()` reads that array and writes
`pubquiz_category_1..N` in pick order (the array's own order), skipping
empty and duplicate ids as defence -- a checkbox group can't actually
produce either.

The Dutch-labelled entries (`Taal`, `Moeilijkheid`, `Categorieën`) are the
plugin's own `{label} => {value}` writes, customer-readable but no longer
the wire format (see "Readable Dutch options and the label-to-key bridge"
below); the `pubquiz_*` keys match `CHECKOUT_META_KEYS` exactly, byte for
byte, with correct slug values -- the same shape `shop:order` produces, and
what the webhook parser (#39) actually reads. No `pubquiz_mode` key exists
any more (ticket #71 removed the `mode` concept from the domain; ticket #72
removed its field from the group and its mapping from the bridge plugin).

## Readable Dutch options and the label-to-key bridge (ticket #57)

Before this ticket, the field group's labels *were* the literal
`CHECKOUT_META_KEYS` strings (e.g. `pubquiz_locale`) and each Category
choice's label was set to the bare numeric id, because the free tier of
Advanced Product Fields writes each order line item's `meta_data` as
`{label} => {value}` -- the label doubled as the wire format, at the cost of
a checkout UI showing customers raw keys and numbers instead of words.

This ticket made the labels Dutch and readable without losing the
`pubquiz_*` wire format, using a second thing the same plugin writes on
every line item alongside the `{label} => {value}` pairs: a `_wapf_meta`
line item meta entry, one array element per field, each carrying
`id`/`label`/`value`/`raw` -- `raw` is the matched choice's *slug*
(untouched by any label), verified directly against the plugin's own
`create_order_line_item()` (`includes/controllers/class-product-controller.php`).
A new must-use plugin, `shop/mu-plugins/pubquiz-checkout-meta.php`, hooks
`woocommerce_checkout_create_order_line_item` at priority 30 (after the
product-fields plugin's own priority-20 hook, so `_wapf_meta` already
exists) and adds a `pubquiz_*` line item meta key per field: `locale` and
`difficulty` map straight to `pubquiz_locale`/`pubquiz_difficulty` from
their (string) `raw` value; `categories` (ticket #72's checkboxes field)
writes `pubquiz_category_1..N` from its (array) `raw` value in pick order
instead -- see "Cap of 8" above for the field ids and shapes as they stand
today (the `mode` field and its `pubquiz_mode` mapping, and the eight
`category_N` selects this paragraph originally described, are gone as of
ticket #72). It hides those `pubquiz_*` keys from the customer-facing item
table, the completed-order mail and My Account, and from the wp-admin order
screen, with the same two filters `pubquiz-downloads.php` already uses for
its own `pubquiz_download_*` keys -- the Dutch-labelled entries remain
visible as the customer's order summary. The webhook's REST payload is not
filtered by either hook, so the parser still sees the `pubquiz_*` keys
unchanged; `src/domain/checkout.ts` and the webhook parser needed no
changes.

`shop-fixture.test.ts` pins `pubquiz-checkout-meta.php`'s field-id-to-key
mapping against `CHECKOUT_META_KEYS`'s literal values, the cap notice text,
and pins that `setup-field-group.php` no longer hardcodes a Category id
list (see below).

## Category names: the Supabase stack, not a hardcoded list (ticket #57)

The 8 Category dropdowns' choices used to be a hardcoded `[1..8]` id list in
`setup-field-group.php` (their labels were the bare ids too, see above) --
that's gone. `npm run shop:up` now reads the running Supabase stack's `nl`
Category translations (`categories` joined to `category_translations`,
`scripts/shop/lib/categories.ts`'s `loadDutchCategories()`) *before* any
WP-CLI call, base64-encodes the `{id, name}` list (avoiding shell-quoting a
JSON array as a `wp eval-file` argument on Windows), and passes it as
`setup-shop.php`'s third positional argument, which decodes it into
`$pubquiz_categories` and hands it to `setup-field-group.php` -- so the
dropdowns follow the seed (and later the admin UI) instead of a number
pinned by hand. This means **`npm run shop:up` now requires the local
Supabase stack to be running and seeded** (`npx supabase start && npm run
db:reset`, see `docs/runbook-local-loop.md`) -- a stopped or unreachable
stack, or a seed with zero Categories, fails `shop:up` fast with a message
naming the stack as the cause, before any WP-CLI call runs.

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
prefixed private note); `pubquiz-checkout-feasibility.php` (ticket #103) has
no guard either, for the same reason.

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

### Cron ticker (ticket #58)

WordPress's pseudo-cron (which drives Action Scheduler, which drives
webhook delivery) only runs on real HTTP traffic, and neither WP-CLI order
creation/update nor `place-order.ts` generates any. Delivering the webhook
within seconds of an order, with no manual step, needs **two** pieces, not
one:

1. **The cron ticker container.** `npm run shop:up` starts a small
   `pubquiz-cron-ticker` container (`curlimages/curl`,
   `scripts/shop/lib/cron-ticker.ts`) that requests
   `http://host.docker.internal:45330/wp-cron.php?doing_wp_cron` every 5
   seconds, silently, for as long as the shop is up; `npm run shop:down`
   stops it. Idempotent like Mailpit's container: a running ticker is
   reused, a stopped one restarted, an absent one created, so running
   `shop:up` twice never starts a second one. This makes WordPress's
   pseudo-cron actually run (check for due cron events) every 5 seconds
   instead of only on the rare real HTTP request this local shop otherwise
   gets.
2. **The fast queue-runner schedule.** Ticking wp-cron.php more often is
   not, by itself, enough: Action Scheduler's queue runner -- the thing
   that actually processes the queued `order.updated` delivery -- is
   itself a WP-Cron *event* (`ActionScheduler_QueueRunner::WP_CRON_HOOK`)
   scheduled on the `every_minute` schedule
   (`ActionScheduler_QueueRunner::WP_CRON_SCHEDULE`), and once scheduled it
   stays on whatever schedule it was given -- a more frequent wp-cron.php
   tick only checks for due events sooner, it doesn't make that event due
   sooner. `shop/mu-plugins/pubquiz-fast-scheduler.php` reschedules it onto
   a `pubquiz_every_5s` schedule via Action Scheduler's own
   `action_scheduler_run_schedule` filter (`ActionScheduler_QueueRunner.php`
   line 91), the first time it finds the event on any other schedule; once
   rescheduled, every later request pays for one `wp_get_schedule()` read
   against the `cron` option -- autoloaded, so an in-memory lookup, not a
   query -- and nothing else. **Gated to `local`/`development`**, same as
   `pubquiz-mailpit-smtp.php`: the 5-second schedule only compensates for
   this local setup's two broken delivery paths (no real HTTP request for
   a WP-CLI order change, and the ticker container's requests can't carry
   Action Scheduler's own async loopback request back out anywhere useful)
   -- a real deployment's async runner already delivers within the same
   request cycle, so this plugin is a no-op in production.
3. **`DISABLE_WP_CRON` (`.wp-env.json`).** Even with both pieces above,
   latency clustered near 0s or near 60s instead of consistently landing
   under 30s: WordPress's own page-load cron spawn
   (`spawn_cron()`/`_wp_cron()`, `wp-includes/cron.php`) writes its
   `doing_cron` transient lock *before* firing a loopback HTTP request back
   to `wp-cron.php` -- a loopback that never completes from inside the
   wp-env container -- so every normal page load (checkout, REST, admin)
   re-armed a lock that then sat for the full `WP_CRON_LOCK_TIMEOUT` (60s),
   during which the ticker's own external `wp-cron.php` requests got
   turned away early by wp-cron.php's own lock check. `DISABLE_WP_CRON`
   makes `_wp_cron()` a no-op on page loads (it returns before ever taking
   the lock) without touching `wp-cron.php` itself, which the ticker calls
   directly and which does not check the constant -- so the ticker's own
   5-second requests are the only thing spawning cron now, and the lock is
   never held by a losing loopback.

**Troubleshooting:** if an order sits in `processing` for more than a
minute, check `docker ps` for `pubquiz-cron-ticker`; if it's missing or
stuck, kick the scheduler by hand as a fallback:

```sh
npx wp-env run cli -- wp action-scheduler run --user=admin
```

The fixture at `shop/fixtures/order-updated-processing.json` was captured
this way, from an order with 3 Category picks (Categorieën checkboxes,
ticket #72), and contains the full captured HTTP request: headers
(including `X-WC-Webhook-Signature`) and the JSON body with the order's
`line_items[].meta_data` containing `pubquiz_locale`, `pubquiz_difficulty`
and `pubquiz_category_1..3` (no `pubquiz_mode`), plus the plugin's own
Dutch-labelled entries and `_wapf_meta`. Its billing email
(`fixture-buyer@example.com`) must stay exactly what
`route.integration.test.ts`'s `FIXTURE_BILLING_EMAIL` constant expects --
that's what every test in that file scopes its cleanup to.

## Checkout feasibility check (spec 5, ticket #103)

`shop/mu-plugins/pubquiz-checkout-feasibility.php` hooks
`woocommerce_after_checkout_validation` and asks the app's
`POST /api/feasibility` (ticket #102) whether every Pubquiz cart line can
actually be generated for the billing email being used, once the email is
known -- so a shortfall that would have failed generation after payment is
instead a plain-Dutch checkout notice, e.g. `Quiz 1: Sport (Moeilijk): 10
vragen te weinig`, naming the cart line and, per Category and Difficulty,
how many Items are short (several short slots of the same Category and
Difficulty -- a single Category pick cycles onto all 8 slots -- collapse
into one segment, the worst-off slot's count). An `invalid` line (an
unknown Category id, more than 8 picks, a duplicate pick) reads `Quiz <n>:
deze samenstelling kan niet worden gemaakt.` instead. No new option or
environment variable: the request URL and signing secret are read from the
shop's own active `order.updated` webhook record (`setup-shop.php`'s
`pubquiz_ensure_webhook()`, same lookup) -- its delivery URL with
`/api/webhooks/woocommerce` replaced by `/api/feasibility`, its secret
signing the body the same way (`X-Pubquiz-Signature:
base64(hmac-sha256(rawBody, secret))`).

**Fail open, 3 seconds.** `wp_remote_post( ..., [ 'timeout' => 3 ] )`; no
webhook found, a `WP_Error`, a non-200, a non-JSON body, or a `lines` array
whose length doesn't match the request all leave checkout untouched and log
one `wc_get_logger()` warning under source `pubquiz-feasibility` (status or
error message only -- never a secret, never an email). Verified locally: on
a cold dev server the first request timed out at the full 3 s (the route
compiling for the first time, not a real slowness) -- warm `POST
/api/feasibility` once (any body, a `401` from a missing signature is
enough to compile the route) before judging response time. With the app
stopped outright, the same previously-refused checkout went through and
`wp-content/uploads/wc-logs/pubquiz-feasibility-<date>-<hash>.log` (viewed
with `npx wp-env run cli -- sh -c "cat wp-content/uploads/wc-logs/pubquiz-feasibility-*.log"`
-- `wp-env run cli` does not expand a glob itself, hence the `sh -c` wrapper;
not `wp wc` -- WooCommerce's file logger has no WP-CLI command of its own)
held `WARNING request failed: cURL error 7: Failed to connect to
host.docker.internal port 3000 ...`.

Category and Difficulty labels for the notice come from the product's own
Advanced Product Fields field group (`Field_Groups::get_field_groups_of_product()`,
the same choices `setup-field-group.php` attaches and
`pubquiz-category-dropdown.php` reads client-side), not a second copy.

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
   separate view). `pubquiz-checkout-meta.php` (ticket #57) uses the same
   pair of filters for its own `pubquiz_*` keys.
6. **A `wp eval-file` script's positional arguments are a *local* `$args`
   variable, not the `$args` superglobal** -- `global $args;` (this file's
   approach before ticket #57) pulls in `$GLOBALS['args']`, which WP-CLI's
   `EvalFile_Command` never sets (it passes the arguments as its own
   `execute_eval()` method's local `$args` parameter, which the evaluated
   code inherits directly, no `global` needed). Verified empirically against
   this wp-env's WP-CLI: a `global $args;` script sees
   `isset($GLOBALS['args'])` false and a bare `count($args)` throw a
   `TypeError` (null given), while the same script without `global` sees
   exactly the command-line arguments. Every `shop:up` run before this
   ticket had therefore silently ignored a non-default
   `WOOCOMMERCE_WEBHOOK_URL`/`WOOCOMMERCE_WEBHOOK_SECRET`, always falling
   through to the literal defaults in `setup-shop.php` -- undetected because
   nobody had set either env var locally, and a wrong/missing argument
   `isset()`s to `false` rather than erroring. This ticket's new required
   third argument (the base64 Categories list) made the bug surface as a
   hard failure instead of a silent no-op; fixed by dropping the `global`
   declaration for all three arguments, not just the new one.

`src/domain/checkout.ts` needed **no changes** -- ticket #57 moved the
label-as-key behaviour to `pubquiz-checkout-meta.php`'s `_wapf_meta` bridge
(see "Readable Dutch options and the label-to-key bridge" above) instead of
requiring the field group's labels to literally be the `CHECKOUT_META_KEYS`
strings.

## Reset

`npm run shop:down` stops (but does not delete) everything; `npm run shop:up`
resumes where you left off. To fully wipe the WordPress database and start
over: `npx wp-env destroy --force` (prompts unless `--force` is given),
then `npm run shop:up` again -- this recreates the product, field group,
gateway, and webhook from scratch. The Mailpit container is unaffected by
`wp-env destroy` (it's managed separately by these scripts); remove it with
`docker rm -f pubquiz-mailpit` if you want a clean mail history along with a
full WordPress reset.
