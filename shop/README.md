# Local shop (ticket #37)

A local WooCommerce shop, run entirely in Docker via `@wordpress/env`, that
lets you place a paid Pubquiz order end-to-end and inspect what the future
webhook receiver (#39) will see. Nothing here talks to Vercel, Supabase, or
any other part of this repo except reading `src/domain/checkout.ts` and
`src/domain/types.ts` for the pinned meta-key/slot constants.

## Commands

| Command | What it does |
| --- | --- |
| `npm run shop:up` | Starts wp-env, then idempotently: starts the Mailpit mail catcher, creates/reuses the Pubquiz product, (re)attaches its Advanced Product Fields field group, switches the Cart/Checkout pages to classic shortcodes (see "Interface gaps"), and creates/updates the `order.updated` webhook. Safe to re-run any time. |
| `npm run shop:down` | Stops wp-env and the Mailpit container. Data is preserved (see "Reset"). |
| `npm run shop:order -- --email a@b.com [--locale nl] [--difficulty easy] [--mode mixed] [--pick 0=<categoryId>] [--quiz ...]` | Creates a **paid, `processing`** order for the Pubquiz product directly via WP-CLI, with `meta_data` set exactly per `CHECKOUT_META_KEYS`. `--quiz` starts a new line item (multi-quiz order); `--pick <slot>=<id>` may repeat for slots 0-7; `--quantity <n>` sets the current line item's quantity. |
| `npm run shop:capture [-- --out <path>] [-- --port <n>]` | A one-shot HTTP listener (default port 3000) that prints and optionally saves the next webhook delivery it receives, then exits. |

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

Both `pubquiz-mailpit-smtp.php` and `pubquiz-test-gateway.php` return early
unless `wp_get_environment_type()` is `local` or `development` (set via
`WP_ENVIRONMENT_TYPE` in `.wp-env.json`); `pubquiz-hold-processing.php` and
`pubquiz-allow-host-webhooks.php` have no such guard since they are meant to
run in production too (`pubquiz-operator-mail.php` is also production code,
gated only by the presence of a prefixed private note).

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
   for updates). `shop:up` deletes and recreates the webhook instead if the
   configured delivery URL ever changes.

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
