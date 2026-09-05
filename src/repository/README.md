Repository: the only module that talks to Postgres (via Supabase). Loads the sampleable Item pool for a Locale, loads a billing email's excluded Item ids, and persists a Composition. May import only `src/domain` and `@supabase/supabase-js`. Never imported by `src/sample` or `src/render`.

## Public seam

`src/repository/index.ts` exports `createRepository(config): ContentRepository`, with:

- `loadPool(locale)` -- every Item that has a translation for `locale`, joined to its Category chain (names in `locale`) and, for Picture/Music Items, their detail row.
- `loadExcludedItemIds(billingEmail)` -- the union of Item ids across every Composition ever persisted for that billing email (the no-repeat rule's source).
- `persistComposition(record)` -- writes one `compositions` row plus its `composition_items` rows (`slot_index`, `position`).
- `downloadPicture(storagePath)` / `downloadMusicClip(storagePath)` -- raw bytes from the `pictures` / `music-clips` Storage buckets.

Private helpers live alongside it: `client.ts` (Supabase client construction), `pool.ts`, `compositions.ts`, `storage.ts`, `types.ts` (the `PoolEntry` / `ItemTranslation` shapes).

`pool.ts`'s two queries that scale with the Item count (the main Items query and the other-Locale translations lookup) are paginated in pages of 1000 (`fetchAllPages`, ordered by a stable key) rather than issued as a single request, so the pool is never silently truncated once the Item count passes PostgREST's `api.max_rows` cap (1000 locally).

`loadExcludedItemIds` and `persistComposition` compare/store billing email trimmed and lower-cased (`normalizeBillingEmail` in `compositions.ts`) -- see CONTEXT.md "No-repeat rule".

## Running the integration tests

The only test file, `repository.integration.test.ts`, runs against the real local Supabase stack -- migrations and seed applied, no mocking. One documented command sequence, from the repo root:

```sh
supabase start
npm run db:reset
npm run test:integration
```

- `supabase start` brings up the local stack on ports 45320-45329 (see `supabase/config.toml`; don't change them).
- `npm run db:reset` applies every migration and `supabase/seed.sql`.
- `npm run test:integration` runs `vitest` against `vitest.integration.config.mts`, which only picks up `src/**/*.integration.test.ts` (the default `vitest.config.mts` excludes that pattern, so `npm test` stays database-free).

The tests read `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the environment; if unset, they fall back to running `supabase status -o env` themselves (`src/repository/test-support/local-stack-config.ts`). A `beforeEach` deletes all rows from `compositions` (cascading to `composition_items`) so tests are independent; seed Items are never touched. Stop the stack afterwards with `supabase stop`.
