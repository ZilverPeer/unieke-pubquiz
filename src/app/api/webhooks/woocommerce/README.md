# webhooks/woocommerce

The WooCommerce `order.updated` webhook route (spec #36, ticket #39). URL is pinned by the shop setup: `npm run shop:up` points the webhook straight at `http://host.docker.internal:3000/api/webhooks/woocommerce` (see `.env.example`, `shop/README.md`).

## Files

- `route.ts` -- `POST` only, a thin Request/Response adapter. Delegates everything else to `handleWebhook`.
- `handle-webhook.ts` -- the decision logic: verify signature → gate on `status === "processing"` → parse line items → upsert → fail bad line items' Quizzes → enqueue jobs for the rest. Takes faked repository/pg-boss deps, so it's unit tested directly (mirrors `src/app/download/resolve-download.ts`'s split from its own `route.ts`).
- `verify-signature.ts` -- `X-WC-Webhook-Signature: base64(hmac-sha256(rawBody, secret))`, constant-time compared (see shop/README.md "The webhook").
- `parse-order.ts` -- pure mapping from a WooCommerce order payload to the repository's `UpsertOrderInput`, using `CHECKOUT_META_KEYS` (`src/domain/checkout.ts`) to read each line item's Locale/difficulty/mode/Category picks. Any other `meta_data` key (e.g. the Advanced Product Fields add-ons plugin's own `_wapf_meta` bookkeeping entry) is simply never read, so nothing needs to special-case ignoring it. Returns a per-line-item parse error map alongside the input.
- `boss-client.ts` -- this route's own lazily-started pg-boss connection (`getBoss`), kept out of `route.ts`. Enqueueing needs no `work()` handler here -- consuming jobs is the worker's job (`src/instrumentation.ts`, `PUBQUIZ_WORKER=1`), entirely separate from this route being able to send them.

## Behaviour

- Wrong or missing signature → 401, nothing persisted, nothing enqueued.
- `status !== "processing"` → 200, nothing persisted.
- Each line item's config is parsed and validated: Locale/difficulty/mode must be one of the known values, each filled Category pick must be a real Category id (checked via `createCategoryIdLookup`, `src/repository/index.ts`). A line item that fails any of these still gets inserted (see "Interface gap" below) and is immediately transitioned to `failed` with the reason; its siblings in the same order are unaffected.
- One line item with quantity *n* yields *n* Quiz rows (`OrderRepository.upsertOrder`already treats a line item's quantity this way).
- A Quiz row this call's `upsertOrder` returned as still `pending` (not one just failed above) gets one pg-boss job sent (`QUIZ_QUEUE`, `singletonKey = quiz.id`). Redelivery is safe by construction: `upsertOrder` never resets a Quiz that already left `pending`, and pg-boss's `exclusive` queue policy makes a second `send()` for the same Quiz id a no-op while a job is already queued or active -- no separate "is this a redelivery" branch is needed.
- Always returns 200 quickly once the signature and status checks pass; no generation work runs in the route (the worker, `src/worker/quiz-job.ts`, does that).

## Interface gap: parse failures and `UpsertOrderInput`

`quizzes.locale` / `quiz_mode` / `requested_difficulty` are `not null` (`supabase/migrations/00008_orders_quizzes.sql`), and `UpsertOrderInput`'s `OrderLineItem.config` requires a fully-typed `QuizConfig` -- there is no way to insert a Quiz row that starts `failed` without also supplying *some* value for every one of those columns. Rather than widen the repository's shape (nullable columns plus a check constraint, a bigger and riskier change for a terminal, unusual case), `parse-order.ts` fills a safe fallback only for the specific field(s) that failed to parse (e.g. Locale defaults to `"nl"` if missing, a bad Category pick is dropped to "unassigned") and records the real reason separately. The route inserts the Quiz as usual, defaulting to `pending`, then transitions it straight to `failed`. The stored fallback config is never used for generation -- a `failed` Quiz's config is only read again if it's retried, and a checkout-capture failure like a missing Locale meta key can't meaningfully be retried from the stored row anyway (the customer would need to re-order); this is a known, documented limitation rather than something this ticket's scope covers fixing.

A second, smaller gap: neither `ContentRepository` nor `OrderRepository` had any way to check whether a Category id exists. Closed with the smallest addition: `createCategoryIdLookup` (`src/repository/index.ts`, `src/repository/categories.ts`), a sibling factory returning every Category id as a `Set<string>`.

## Environment variables

- `WOOCOMMERCE_WEBHOOK_SECRET` -- shared secret for signature verification (see `.env.example`; defaults to `test-secret` locally).
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` -- the repository's connection to the local Supabase stack (`resolveLocalStackConfig`, `src/repository/local-stack-config.ts`); falls back to `supabase status -o env` when unset.
- `DATABASE_URL` -- the Postgres connection string pg-boss uses as its own store (`resolveDatabaseUrl`, `src/worker/boss.ts`); falls back to the local Supabase stack's default Postgres port.

## Must stay public

No auth middleware exists in this app yet (no `src/middleware.ts` or `src/proxy.ts`). WooCommerce has no way to carry a session or API key on this call -- the HMAC signature above is the only authentication this route has, and it verifies the request itself, not a user. If an auth proxy/middleware is added later, this route (`/api/webhooks/woocommerce`) must stay excluded from it.
