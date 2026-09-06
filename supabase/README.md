# Supabase: schema and seed

Local stack ports are 45320-45329 (see `config.toml`) so this project can run
alongside another local Supabase stack on the same machine. Do not change
them.

## Commands

- `npm run db:reset` (`supabase db reset`) — recreates the local database,
  applies every migration under `supabase/migrations/`, then applies
  `supabase/seed.sql`, then seeds Storage buckets from
  `supabase/seed-assets/` (`[storage.buckets.*].objects_path` in
  `config.toml`).
- `npm run db:types` — regenerates `src/repository/database.types.ts` from the
  local database.
- `supabase seed buckets` — re-uploads the seed asset files into the
  `pictures` and `music-clips` buckets without a full reset, if the buckets
  are ever emptied without a reset.

## Schema

Versioned migrations under `supabase/migrations/`, one concern per file:

1. `00001_enums.sql` — `locale`, `item_kind`, `difficulty`, `quiz_mode`,
   `requested_difficulty`.
2. `00002_categories.sql` — the 3-level `categories` -> `subcategories` ->
   `subsubcategories` hierarchy, each with a `*_translations` table keyed
   `(parent_id, locale)`.
3. `00003_items.sql` — `items`, `item_translations`, `picture_item_details`,
   `music_item_details`.
4. `00004_compositions.sql` — `compositions`, `composition_items`.
5. `00005_rls.sql` — Row Level Security enabled on every table, no policies.
6. `00006_storage_buckets.sql` — the `pictures` and `music-clips` Storage
   buckets, private, also created here (not only via `config.toml`) so
   `supabase db push` against a hosted project creates them too.

See `CONTEXT.md` ("Content model") and
`docs/adr/0004-shared-item-identity-per-locale-translations.md` for the
reasoning behind the shape.

## Row Level Security

Every table has RLS enabled and no policies, so `anon` and `authenticated`
can read and write nothing; only `service_role` (which has `BYPASSRLS`) can
reach the data. Verify:

```sql
-- All rows true:
select relname, relrowsecurity
from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r';

-- Returns 0 rows (not an error, because anon is a role with SELECT
-- privilege via Supabase's default grants, but RLS blocks every row):
set role anon;
select count(*) from items;
reset role;
```

## Pool coverage

The seed (`supabase/seed.sql`) needs to make a full Quiz fillable at every
requested Difficulty, in both Locales: 6 Text Rounds + 1 Picture Round + 1
Music Round, 10 Items each, no two Items in a Round sharing a Subsubcategory,
and no Item repeating anywhere else in the same Quiz (see `src/sample`'s
README for the exact rules, including issue #34's cross-Round fix).

Shape: 8 Categories, each with 2 Subcategories, each with 5 Subsubcategories
(10 Subsubcategories per Category). Every Subsubcategory gets 7 text Items
and 1 picture + 1 music Item per (kind, difficulty) combination — 27 Items
per Subsubcategory, 2160 Items total (1680 text, 240 picture, 240 music).

This means, per Category and per kind, there are exactly 10 Subsubcategories
carrying an Item of any given Difficulty: the minimum for a Round of 10 to
never repeat a Subsubcategory. Picture and music keep zero slack here
(exactly 10 Items per Category/Difficulty) — the check below verifies this
holds everywhere it needs to. Text is 7x denser (70 Items per
Category/Difficulty) because a single-category Quiz draws 6 distinct Text
Rounds — 60 Items, none repeated — from one Category, leaving 10 Items of
slack over that floor. Per Locale and per Difficulty this yields 560 text
Items and 80 picture / 80 music Items (8 Categories x 10 Subsubcategories,
x7 for text), well over the "at least 60 text + 10 picture + 10 music" floor
for a mixed-mode Quiz, and spread across all 8 Categories rather than
concentrated in one. That covers both Quiz modes:

- **Mixed mode** (up to 8 distinct Categories, one Round per Category): each
  of the 8 Categories independently has enough Items and Subsubcategories to
  fill whichever Round type lands on it.
- **Single-category mode** (one Category fills all 8 Rounds): a Category
  supplies 60 *distinct* Text Items for its 6 Text Rounds — `sampleComposition`
  excludes every Item already placed earlier in the same Quiz, so Rounds
  cannot reuse each other's Items even though they may reuse a
  Subsubcategory (the no-duplicate-Subsubcategory rule only applies within a
  single Round). 70 Items per Category/Difficulty covers the 60 needed with
  10 to spare.

A documented handful of Items (6, listed in `supabase/seed.sql` section 5) get
a translation in only one Locale, so ticket #6's repository tests can prove
Locale filtering. They're few enough not to threaten the coverage floor in
either Locale.

Run the check:

```sh
supabase db query < supabase/checks/pool-coverage.sql
```

or, if `supabase db query` piping isn't available in your CLI version,
against the DB container directly (DB port 45322 locally):

```sh
docker exec -i $(docker ps --filter "name=supabase_db" --format "{{.Names}}") \
  psql -U postgres -d postgres -f - < supabase/checks/pool-coverage.sql
```

The first query reports `sampleable_items`, `distinct_subsubcategories`, and
`meets_threshold` per (kind, locale, difficulty) — every row should show
`meets_threshold = true`. The second reports distinct Subsubcategories per
(category, kind, difficulty) — every row should show `>= 10`.

## Seed assets

`supabase/seed-assets/` holds a handful of tiny, non-copyrighted placeholder
files, whitelisted in `.gitignore` despite the general content ban (see
`CLAUDE.md` "Content never enters git" and the `.gitignore` comment):

- `pictures/` — four 64x64 solid-colour PNGs, generated with `ffmpeg -f lavfi
  -i color=c=<colour>:s=64x64 -frames:v 1 <file>.png`.
- `music-clips/` — four 4-second mono 44.1kHz sine-tone MP3s, generated with
  `ffmpeg -f lavfi -i "sine=frequency=<hz>:duration=4" -ac 1 -ar 44100
  -codec:a libmp3lame -qscale:a 9 <file>.mp3`.

`picture_item_details.storage_path` and `music_item_details.storage_path`
reuse these same few files across many Items — the object key is the file
name only (the bucket already namespaces it), e.g. `placeholder-blue.png`.
