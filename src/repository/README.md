Repository: the only module that talks to Postgres (via Supabase). Loads the sampleable Item pool for a Locale, loads a billing email's excluded Item ids, and persists a Composition. May import only `src/domain` and `@supabase/supabase-js`. Never imported by `src/sample` or `src/render`.

## Public seam

`src/repository/index.ts` exports `createRepository(config): ContentRepository`, with:

- `loadPool(locale)` -- every Item that has a translation for `locale`, joined to its Category chain (names in `locale`) and, for Picture/Music Items, their detail row.
- `loadExcludedItemIds(billingEmail)` -- the union of Item ids across every Composition ever persisted for that billing email (the no-repeat rule's source).
- `persistComposition(record)` -- writes one `compositions` row plus its `composition_items` rows (`slot_index`, `position`).
- `getCompositionById(compositionId)` -- `null` when not found, otherwise the same `CompositionRecord` shape `persistComposition` writes (slots rebuilt from `composition_items`, ordered by `slot_index`/`position`). Added for the `--composition` dev script flag (ticket #42): re-rendering an existing Composition without a new `compositions` row needs to read one back by id.
- `downloadPicture(storagePath)` / `downloadMusicClip(storagePath)` -- raw bytes from the `pictures` / `music-clips` Storage buckets.

`src/repository/index.ts` also exports `createDeliverableUploader(config): UploadDeliverable` (spec #36, ticket #40) -- `(storagePath, data, contentType) => Promise<void>`, uploading to the private `deliverables` bucket with `upsert: true` (a retried or re-rendered Quiz overwrites its own prior files at the same `<quiz id>/<file name>` path). A sibling factory, not a method on `ContentRepository`: it's needed only by the worker's write side.

Two more sibling factories, both ticket #42, both Storage on the same private `deliverables` bucket:

- `createDeliverableDownloader(config): DownloadDeliverable` -- `(storagePath) => Promise<Uint8Array>`, for the download route. Throws when the object is missing (mirrors `downloadPicture`/`downloadMusicClip`'s own `downloadFromBucket`); the route's `resolveDownload` turns that into a 410 (object gone, token still recognised).
- `createDeliverableRemover(config): RemoveDeliverables` -- `(storagePaths) => Promise<void>`, for the daily pruning job. A no-op for an empty array (pruning a Quiz with nothing left to delete is not an error).

Private helpers live alongside it: `client.ts` (Supabase client construction), `pool.ts`, `compositions.ts`, `storage.ts`, `types.ts` (the `PoolEntry` / `ItemTranslation` shapes).

`pool.ts`'s two queries that scale with the Item count (the main Items query and the other-Locale translations lookup) are paginated in pages of 1000 (`fetchAllPages`, ordered by a stable key) rather than issued as a single request, so the pool is never silently truncated once the Item count passes PostgREST's `api.max_rows` cap (1000 locally).

`loadExcludedItemIds` and `persistComposition` compare/store billing email trimmed and lower-cased (`normalizeBillingEmail` in `compositions.ts`) -- see CONTEXT.md "No-repeat rule".

## Order repository

`src/repository/index.ts` also exports `createOrderRepository(config): OrderRepository` (spec #36, ticket #38) -- a **sibling** of `createRepository`/`ContentRepository`, not folded into it. Orders and Quizzes are not content: they're what the webhook (#39) and the pg-boss worker (#40) act on, and merging the two would grow `ContentRepository` (used by sample/render-side code) with methods those callers never need. Both factories share the same `client.ts`/`RepositoryConfig`.

`OrderRepository`:

- `upsertOrder(input)` -- upserts one `orders` row keyed on `woo_order_id`, and one `quizzes` row per line item unit (`quantity` n yields sequence `0..n-1`), keyed on `(order_id, woo_line_item_id, sequence)`. Idempotent: repeated calls with the same input never duplicate rows, never reset a Quiz that has already left `pending` (existing Quiz rows are left untouched -- only missing ones are inserted), and refresh the order's `wooStatus`/`rawPayload`.
- `transitionQuizStatus(quizId, to, options?)` -- moves a Quiz along `QUIZ_STATUS_TRANSITIONS` (`src/domain/orders.ts`); an edge not listed there throws `IllegalQuizTransitionError`. `options.failureReason` is stored when transitioning to `failed`; transitioning to `pending` always clears it. Writes with a compare-and-swap (`.eq("status", <status read just before>)`); if another writer changed the status in between, this throws `QuizStatusChangedConcurrentlyError` instead of silently overwriting it -- distinct from `IllegalQuizTransitionError` so a caller (the worker) can retry a lost race rather than treat it as an illegal edge.
- `recordDelivery(quizId, { compositionId, downloadToken })` -- sets `compositionId`, `downloadToken` and `deliveredAt` together with the transition to `delivered` (so a Quiz can only be `delivered` with all three set). Same compare-and-swap guard and `QuizStatusChangedConcurrentlyError` as `transitionQuizStatus`.
- `clearDownloadToken(quizId)` -- nulls the token without changing status, for the daily pruning job.
- `listQuizzesByBillingEmail(billingEmail)` -- newest first, billing email normalised the same way as `loadExcludedItemIds`.
- `listQuizzesDeliveredBefore(cutoff)` -- `delivered` Quizzes with a non-null token whose `deliveredAt` is before `cutoff` (the pruning job's candidate set; a Quiz whose token was already cleared is excluded).
- `getQuizById(quizId)` / `getQuizByDownloadToken(downloadToken)` -- `null` when not found.
- `listPendingQuizzes()` -- for the worker's startup sweep.
- `getOrderById(orderId)` -- `null` when not found. Added for the worker (ticket #40): `generateQuiz` needs the order's billing email, which `QuizRecord` doesn't carry (billing email lives on `orders`, never denormalised onto `quizzes`). The ticket #40 brief named `storage.ts` as the only repository change; this one small, same-shape addition (mirrors `getQuizById`) turned out to be required too -- see that ticket's PR for the note.
- `listFailedQuizzes()` -- every Quiz with `status = "failed"`, no age filter. Added for the daily pruning job (ticket #42): a `failed` Quiz's `deliveredAt` is never set (only `delivered` sets it, `recordDelivery`), so it can never appear in `listQuizzesDeliveredBefore`'s candidate set -- its own leftover Storage objects (from a mid-upload failure on the render pipeline's last retry attempt, see `src/worker/README.md` "Known limitations") need this separate, undated listing to ever get cleaned up.
- `getQuizByCompositionId(compositionId)` -- `null` when not found. Added for the `--composition` dev script flag (ticket #42): finds the Quiz to re-attach re-rendered Deliverables to (a Composition doesn't know its own Quiz; the foreign key points the other way).

`orders.ts` holds the implementation. `CategoryPick`'s `undefined` (an unassigned slot) has no jsonb equivalent, so it round-trips through `category_picks` as `null` and is converted back to `undefined` on read (`toCategoryPicks`), keeping `QuizRecord` exactly matching the pinned `src/domain/orders.ts` shapes.

Deleting an `orders` row while any `quizzes` row references it fails (no cascade, migration `00008_orders_quizzes.sql`); the same is true for a `compositions` row referenced by a Quiz's `composition_id`. Deleting a Quiz never touches its Composition.

## Running the integration tests

Two test files, `repository.integration.test.ts` and `orders.integration.test.ts`, run against the real local Supabase stack -- migrations and seed applied, no mocking. One documented command sequence, from the repo root:

```sh
supabase start
npm run db:reset
npm run test:integration
```

- `supabase start` brings up the local stack on ports 45320-45329 (see `supabase/config.toml`; don't change them).
- `npm run db:reset` applies every migration and `supabase/seed.sql`.
- `npm run test:integration` runs `vitest` against `vitest.integration.config.mts`, which only picks up `src/**/*.integration.test.ts` (the default `vitest.config.mts` excludes that pattern, so `npm test` stays database-free).

The tests read `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the environment; if unset, they fall back to running `supabase status -o env` themselves (`src/repository/test-support/local-stack-config.ts`). `repository.integration.test.ts`'s `beforeEach` deletes all rows from `compositions` (cascading to `composition_items`); `orders.integration.test.ts`'s `beforeEach` deletes all rows from `quizzes` then `orders` (in that order, since orders has no cascade). Seed Items are never touched. Stop the stack afterwards with `supabase stop`.
