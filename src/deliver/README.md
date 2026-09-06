# deliver

Deliverables to WooCommerce, the third module of the pipeline (CONTEXT.md "Pipeline orthogonality"). It attaches download URLs to a line item, completes an order once every Quiz of it is delivered, and adds private operator notes for failures, all through the WooCommerce REST API.

May know: Quiz ids, order ids, line item ids, file URLs, failure reasons.
May not know: Items, Compositions, Storage paths. Never imports from `sample` or `render`.

## Public seam

`index.ts` exports the pinned `Deliverer`/`DeliveredFile` shapes (spec #36) and:

- `createDeliverer(config: DelivererConfig, orderLookup: OrderLookup): Deliverer` -- both arguments are plain data/interfaces, so the whole module is testable against an in-process HTTP stub with no real shop involved (`deliverer.test.ts`).
- `resolveDelivererConfigFromEnv()` -- reads `WOOCOMMERCE_URL` / `WOOCOMMERCE_CONSUMER_KEY` / `WOOCOMMERCE_CONSUMER_SECRET` (see `.env.example`), throwing if any is missing. The worker's composition root (`src/worker/index.ts`) is the only caller.
- `createOrderLookup(repository: OrderRepository): OrderLookup` -- see "Order lookup" below.

## How downloads are attached

WooCommerce has no supported REST way to attach a per-order downloadable file to a line item, and adding files to the *product's* downloads would leak every customer's Deliverables to every other order of the same product. Instead, `deliverQuiz` writes each Deliverable's URL as line item `meta_data` (`PUT /wp-json/wc/v3/orders/<id>` with `line_items: [{ id, meta_data: [{ key, value }] }]`), one key per file (`downloadMetaKey`, `src/domain/checkout.ts`: `pubquiz_download_<file>`). A must-use shop plugin, `shop/mu-plugins/pubquiz-downloads.php`, renders those keys as labelled links in the customer's order view, the completed-order email, and My Account -> Downloads, and hides the raw key/value pairs from the customer-facing item meta table. `src/domain/shop-fixture.test.ts` checks the plugin's meta-key-prefix literal stays in sync with `downloadMetaKey` (PHP cannot import the TypeScript constant).

`deliverQuiz` is idempotent: it `GET`s the order first, so a retried or duplicate call for the same Quiz updates the same four `meta_data` entries in place (by their WooCommerce meta id) instead of appending duplicates. Once every Quiz of the order is `delivered` (per `OrderLookup`'s sibling statuses) and the order isn't already `completed`, a second `PUT` sets `status: "completed"` -- WooCommerce's own completed-order email then goes out. A `failed` sibling means that condition is never true, so the order simply never completes; nothing goes to the customer (CONTEXT.md "Delivery").

`noteFailure` adds a private (`customer_note: false`) order note via `POST /wp-json/wc/v3/orders/<id>/notes`, prefixed with `OPERATOR_NOTE_PREFIX` (`src/domain/checkout.ts`) so the shop's `pubquiz-operator-mail.php` mu-plugin alerts the operator; the order's status is left untouched.

Any non-2xx response or network error (connection refused, DNS failure, etc.) throws an `Error` naming the HTTP method, the full endpoint URL, and (for a response) its status code, so the worker's retry loop can tell a retryable failure from a bug.

## Order lookup

`createDeliverer` never talks to the repository itself -- `order-lookup.ts` is the one file in this module that imports `@/repository`, wrapping `createOrderRepository`'s `getQuizById`/`getOrderById`/`listQuizzesByOrderId` as the small `OrderLookup` interface (`forQuiz(quizId) => { wooOrderId, wooLineItemId, siblingStatuses }`) `createDeliverer` actually needs. This keeps the module's own dependency surface to "WooCommerce plus one small lookup interface" and means `deliverer.test.ts` can stub that interface directly instead of a real repository.

## Environment variables

See `.env.example`. `WOOCOMMERCE_URL`, `WOOCOMMERCE_CONSUMER_KEY`, `WOOCOMMERCE_CONSUMER_SECRET` -- all three required, no defaults. `npm run shop:up` creates a REST API key (description `pubquiz-pipeline`) and writes all three to a gitignored `.env.shop.local` at the repo root (`scripts/shop/lib/rest-api-key.ts`); copy them into your own environment (or `.env.local`) to run the worker against the local shop outside `shop:*`.

## Interface pinned on master

`Deliverer`/`DeliveredFile` are pinned for spec #36; the worker (#40) codes against that shape and tested with its own stub before this module existed. Implemented here (#41).
