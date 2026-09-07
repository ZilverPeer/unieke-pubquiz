# Runbook: the local order-to-delivery loop (spec #36 / ticket #43)

Every command below was actually run against this branch (ticket #43) to produce the acceptance evidence recorded at the bottom of this document. Windows/PowerShell notes are called out where a command differs from the plain form (see `shop/README.md`, `src/scripts/README.md` for the underlying `--` forwarding issue).

## One-time setup

1. Install dependencies: `npm ci`.
2. Copy the env template: `cp .env.example .env.local` (PowerShell: `Copy-Item .env.example .env.local`). This is the **one** env file every process in this loop reads -- see README.md "Environment variables". You don't need to fill anything in by hand; `npm run shop:up` (below) writes the WooCommerce REST credentials into it for you.
3. Start the local Supabase stack and seed it (skip if it's already running and seeded):
   ```sh
   npx supabase start
   npm run db:reset
   ```
4. Start the local shop (wp-env + Mailpit + the Pubquiz product/fields/webhook/REST key):
   ```sh
   npm run shop:up
   ```
   This upserts `WOOCOMMERCE_URL` / `WOOCOMMERCE_CONSUMER_KEY` / `WOOCOMMERCE_CONSUMER_SECRET` into `.env.local`. Re-run it any time (idempotent) -- e.g. after `.env.local` gets wiped, or after `npx wp-env destroy`.

## Daily start commands

With the Supabase stack and the shop already up (steps 3-4 above are idempotent, safe to skip if they're already running):

```sh
PUBQUIZ_WORKER=1 npx next dev
```

(PowerShell: `$env:PUBQUIZ_WORKER=1; npx next dev`.) This starts the app on `http://localhost:3000`, which serves the webhook route, the download route, and the pg-boss worker (started from `src/instrumentation.ts`) in one process -- see `src/worker/README.md`. Look for `[worker] started (queue "quiz-generation"); swept N pending Quiz job(s)` in the log to confirm the worker came up.

Leave this running. In another shell:

```sh
npx tsx scripts/shop/place-order.ts --email you@example.com --locale nl --difficulty easy --mode mixed --pick 0=1
```

placing a **paid, `processing`** order directly (see `shop/README.md`). WooCommerce delivers its `order.updated` webhook asynchronously via Action Scheduler, which needs real HTTP traffic to tick in this local setup -- a bare WP-CLI order change doesn't trigger it on its own. Kick it manually after every order (or every order status change) you want delivered:

```sh
npx wp-env run cli -- wp action-scheduler run --user=admin
```

The worker picks the job up on its own next poll (well under a second locally); watch the `next dev` log for `POST /api/webhooks/woocommerce 200` followed, once generation finishes, by the deliver module's calls completing the order.

### Multi-quiz orders

Start a second line item with `--quiz`:

```sh
npx tsx scripts/shop/place-order.ts --email you@example.com \
  --locale nl --difficulty easy --mode mixed --pick 0=1 \
  --quiz --locale en --difficulty hard --mode single_category --pick 0=2
```

### A failing order (impossible configuration)

Either an unknown Category id (fails at webhook parse time, before any generation attempt) or a `single_category` pick with too few Items for that Category (fails during generation, a `QuizShortfallError`). The unknown-id form is the simplest to reproduce on demand:

```sh
npx tsx scripts/shop/place-order.ts --email you@example.com --locale nl --difficulty easy --mode single_category --pick 0=999999
npx wp-env run cli -- wp action-scheduler run --user=admin
```

The order stays `processing`; check the order note and the operator alert mail (see "Inspecting mail" below).

## Inspecting mail

Mailpit's web UI: http://127.0.0.1:45332. Its REST API is handy for scripting checks:

```sh
curl -s http://127.0.0.1:45332/api/v1/messages          # list
curl -s -X DELETE http://127.0.0.1:45332/api/v1/messages # clear, before placing a fresh order
curl -s http://127.0.0.1:45332/api/v1/message/<message-id>  # one message, HTML/Text/headers included
```

Three mails per successful order: "... order has been received!" (pending->processing), "[Pubquiz-wt-N]: New order #N" (to the shop admin), and once every Quiz is delivered, "Your ... order is now complete" (the one with the download links, WooCommerce's own completed-order template). A failed Quiz instead produces "[Pubquiz] Order #N needs attention" (the operator alert, from `shop/mu-plugins/pubquiz-operator-mail.php`) and never a completed-order mail.

## Inspecting jobs (pg-boss)

pg-boss keeps its own `pgboss` schema in the same Postgres database the app uses (`src/worker/README.md` "The `pgboss` schema") -- it's not exposed through Supabase's REST API (PostgREST only serves `public` by default), so query it directly against the Postgres container:

```sh
docker exec supabase_db_unieke-pubquiz psql -U postgres -d postgres -c \
  "select id, name, state, retry_count, created_on, completed_on from pgboss.job order by created_on desc limit 10;"
```

`state` is one of pg-boss's own values (`created`, `active`, `completed`, `failed`, ...) -- a `quiz-generation` job going straight to `completed` on its first attempt is the normal happy path (recall the worker's own retry logic runs *inside* the handler for the terminal-failure case, so a `failed` Quiz still shows as a `completed` pg-boss job -- see `src/worker/README.md`).

## Inspecting the database

Supabase Studio: http://127.0.0.1:45323 (browse/query `orders`, `quizzes`, `compositions`, `composition_items` directly). Or the same `docker exec psql` pattern as above, e.g.:

```sh
docker exec supabase_db_unieke-pubquiz psql -U postgres -d postgres -c \
  "select id, woo_order_id, billing_email, status from orders order by created_at desc limit 5;"
docker exec supabase_db_unieke-pubquiz psql -U postgres -d postgres -c \
  "select id, order_id, sequence, status, failure_reason, composition_id, download_token from quizzes order by created_at desc limit 5;"
```

`orders.status` is set once, at webhook receipt (the WooCommerce order status the webhook payload carried), and is never updated afterwards -- completion (`processing` -> `completed`) happens only in WooCommerce itself, once the order has downloadable files attached (see `src/app/api/webhooks/woocommerce/README.md`). Do not read a local `orders.status` still showing `processing` as the order being stuck; check the order in WordPress admin (or `quizzes.status`, which the worker does update through `delivered`/`failed`) instead.

## Downloading a Deliverable directly

Every download link is `http://localhost:3000/download/<token>/<file>` (`downloadPath`, `src/domain/orders.ts`) -- reachable straight from a browser or `curl` once `next dev` is running, since it's the same host/port the link's own base URL (`APP_BASE_URL`, defaults to `http://localhost:3000`) points at:

```sh
curl -o quizmaster.pdf "http://localhost:3000/download/<token>/quizmaster.pdf"
```

## Webhook redelivery (proving idempotency)

The WooCommerce admin's Webhooks screen has a per-delivery "Redeliver" button (Marketing -> Webhooks -> the webhook -> a logged delivery), which calls `WC_Webhook::deliver()` again for the same order. The WP-CLI-scriptable equivalent (no native `wp wc webhook deliver <id>` subcommand exists):

```sh
npx wp-env run cli -- wp eval '$w = new WC_Webhook(1); $o = wc_get_order(<order id>); $w->deliver($o); echo "ok";' --user=admin
```

(webhook id `1` is `pubquiz-order-updated`, created by `shop:up`; confirm with `npx wp-env run cli -- wp wc webhook list --user=admin --format=json`.) Redelivering a `completed` order's webhook is a fast no-op (`status !== "processing"` gate, `handle-webhook.ts`) -- verified empirically: same order id, same two Quiz ids/composition ids/download tokens, same four Storage objects per Quiz, before and after.

Note: WooCommerce also sends its own unsigned connectivity **ping** (`webhook_id=<n>`, form-urlencoded, no `X-WC-Webhook-Signature`) whenever `wp wc webhook update --status=active` runs (i.e. every `npm run shop:up`), queued and delivered the same way as real deliveries. Our route correctly answers it `401` (no valid signature) -- this is expected WooCommerce core behaviour (`class-wc-webhook.php`), not a defect; it does not increment the webhook's `failure_count` and has no effect on order processing.

## Stopping everything

```sh
npm run shop:down        # stops wp-env + Mailpit, keeps their data
npx supabase stop        # stops the Supabase stack, keeps its data
```

Stop `next dev` with Ctrl-C. To fully reset the shop's WordPress database: `npx wp-env destroy --force && npm run shop:up` (see `shop/README.md` "Reset"); to fully reset the app's database: `npm run db:reset`.

## What was verified for ticket #43 (evidence)

- **Happy path**: order created via `place-order.ts` reached `completed` on its own (worker picked up the job without any manual retry/nudge beyond the one `action-scheduler run` needed to fire WooCommerce's own async delivery locally); the completed-order mail in Mailpit carried four working `http://localhost:3000/download/...` links; all four returned `200` with real file bytes.
- **File equivalence**: re-rendering the same Composition via `--composition <id>` and re-downloading through the same token produced PDFs identical in size (and content except for `@react-pdf/renderer`'s embedded `/CreationDate`/`/Creator` timestamp objects -- confirmed by diffing the differing byte ranges) and an MP3 within 1 byte of the original size (ffmpeg's own encode is not byte-deterministic run to run; duration/content is unchanged). PDF rendering is therefore not byte-deterministic across runs of the *same* Composition -- sizes match, not hashes.
- **No-repeat**: two orders for the same billing email produced two Compositions with 80 Items each and **zero** overlapping Item ids between them.
- **Failure path**: an order with an unknown Category id stayed `processing`, carried a `[pubquiz] line item ...: unknown Category id "999999" at slot 0` private note, produced the `[Pubquiz] Order #N needs attention` alert mail, and had no `pubquiz_download_*` meta on its line item.
- **Multi-quiz order**: one order with two differently configured line items (`nl`/easy/mixed and `en`/hard/single_category) reached `completed` with 8 distinct download links (4 per Quiz) in one completed-order mail.
- **Webhook redelivery**: manually redelivering the webhook for an already-`completed` order left the order/Quiz rows and Storage objects unchanged (same ids, same 4 files per Quiz, no duplicates).
