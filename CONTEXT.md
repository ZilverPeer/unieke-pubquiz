# Pubquiz — Domain Glossary

## Terms

**Content** — actual quiz material: question/answer rows, image files (picture rounds, flags), audio clips (music rounds), and any generated deliverables containing real quiz data. Lives in Supabase (Postgres tables + Storage buckets), never committed to git.

**Code** — application logic, schema/DDL definitions (no data rows), configuration, and static app assets (e.g. the number-announcement audio files). Lives in the GitHub repo.

**Category** — a broad subject a question belongs to, e.g. "Sports", "History", "Music".

**Subcategory** — a narrower slice within one Category, e.g. "Sports" → "Football".

**Subsubcategory** — the most granular bucket, nested under one Subcategory, e.g. "Football" → "World Cup". This is the unit used for the round-composition anti-repetition rule (a round may not contain two questions from the same Subsubcategory).

**Locale** — one of the two quiz languages, `nl` or `en`. Chosen once per Quiz at checkout. Everything customer-facing in a generated Quiz (question text, answers, facts, category names, round headings, answer sheets, spoken announcements) is rendered in that one Locale.

**Item** — the atomic, sampleable unit of quiz content. Three kinds exist — Text Item (question + answer), Picture Item (single image + answer), Music Item (single pre-cut audio clip + artist/title) — and all three carry the same Category/Subcategory/Subsubcategory/Difficulty shape and are sampled the same way. An Item has **one identity across Locales**: its language-dependent text lives in a per-Locale translation row (see [ADR-0004](docs/adr/0004-shared-item-identity-per-locale-translations.md)), and an Item is only sampleable for a Locale if a translation exists for it. Pools may therefore differ in size per Locale. Distinct from a **Round** (see below): an Item is one piece of content; a Round is the assembled section of a quiz built from several Items.

**Translation** — the Locale-specific text of an Item (question, answer, Fact) or of a Category/Subcategory/Subsubcategory (name). Music Item artist/title are language-neutral and not translated.

**Fact** — an optional single text blurb on an Item, shown after the answer is revealed (e.g. "this photo was taken in 1969"). Not required, not multi-valued, not its own entity — a nullable field on the Item's Translation.

**Round** — one themed section of a generated quiz, composed from multiple Items of one kind (a Text Round from Text Items, a Picture Round from Picture Items, a Music Round from Music Items). Picture Rounds insert 10 Picture Items into a styled PDF grid. Music Rounds are built dynamically: for each of the 10 Music Items, a spoken **Announcement** ("Nummer 1" / "Track 1", in the Quiz's Locale) followed by the Item's clip, concatenated into one MP3.

**Music clip** — the stored audio of a Music Item is already cut to its playable length (roughly 15–25 s) at upload time. Generation only concatenates and loudness-normalises; it never trims. No full-length songs are stored.

**Announcement** — one of 20 short static audio files (numbers 1–10 × 2 Locales) spoken before each clip in a Music Round. Generated once with a free text-to-speech voice by a script in the repo and committed as app assets — not Content.

**Quiz** — the generated deliverable for one order line: a fixed structure of 8 Round slots — 6 Text Rounds + 1 Picture Round + 1 Music Round — each slot themed around exactly one Category. The customer may explicitly assign a Category to any subset of the 8 slots (any round type, not just Text); any slots left unassigned are filled with a randomly-chosen Category.

Every Round — Text, Picture, or Music — contains exactly 10 Items. (60 Text Items total across the 6 Text Rounds, 10 Picture Items, 10 Music Items.)

A Quiz has a **Quiz mode**: `mixed` (the default flow above — up to 8 customer-picked Categories, unique across all 8 slots, rest randomized) or `single_category` (all 8 slots use one customer-chosen Category — the uniqueness rule doesn't apply here, it's a different mode, not an exception to it).

**Composition** — the exact list of Item ids per Round slot that a generated Quiz consists of, stored permanently per Quiz. It is the source for the no-repeat rule and allows any Quiz to be re-rendered later without re-sampling.

**Deliverables** — the files a customer receives per Quiz, all in the Quiz's Locale:
1. **Quizmaster PDF** — all rounds with questions and answers (including Picture Round answers and Music Round artist/title), plus Facts.
2. **Picture Round handout PDF** — the numbered image grid for the teams, with an answer line under each image, so it doubles as that round's answer sheet.
3. **Answer sheet PDF** — one A4 per team: six 1/8-page sheets for the Text Rounds and one 1/4-page sheet for the Music Round (artist + title lines), with cut lines. No separate Picture Round sheet (see 2).
4. **Music Round MP3** — one track, built as described under Round.

**No-repeat rule**: a customer never receives the same Item twice across their full order history — unbounded (no "last N orders" cutoff, no per-category scoping), and across Locales (an Item delivered in Dutch is also excluded from that customer's future English quizzes). Sampling for a new order excludes every Item in every past Composition for that customer. "Customer" is identified by **billing email**, not WooCommerce account ID — this covers guest checkouts too, since WooCommerce always captures a billing email regardless of account status.

**Generation failure policy**: if a Round can't be filled to its full 10 Items after applying the no-repeat and no-duplicate-Subsubcategory rules, generation hard-fails and alerts the operator — it never silently ships a short/degraded round. (The legacy system did the opposite: logged a warning and shipped fewer questions anyway — a known bug pattern this rebuild explicitly avoids.)

**Physical Quiz delivery** *(future, not building now)* — an option for a customer to receive a printed, mailed copy of their Quiz instead of (or alongside) digital delivery. The generated content is identical either way — this only affects the fulfillment path (shippable WooCommerce product + a print/mail step) and would add a shipping address requirement, not the generation pipeline. Flagged so the digital-only Delivery decision below isn't accidentally treated as a permanent constraint.

**Curated Quiz** *(future, not building now)* — a themed/preset quiz (e.g. a "Year in Review" product) that is fully fixed: not just categories but the exact Items in each round, set in stone rather than sampled. Structurally this is just a Quiz whose Composition is authored instead of sampled — flagged here so schema/generation code isn't designed in a way that forecloses it, but not in scope for the current build.

## Decisions

### Cost and hosting
- **Cost constraint**: apart from the Claude subscription, the only accepted recurring cost is **one VPS** (needed for self-hosted WordPress anyway) plus the existing domain. Everything else must run on free tiers: Supabase Free, no paid email/queue/TTS/ads services. Adding any recurring cost is a decision for Erik, never a default.
- **Hosting**: WordPress + WooCommerce **and** the Next.js app both run on that single VPS (Docker), see [ADR-0003](docs/adr/0003-nextjs-on-vps-not-vercel.md). Vercel is **not** used for production: the linked Hobby team forbids commercial use and Pro would be a recurring cost. The VPS provider is not chosen yet — deferred until there is something to deploy; all development happens locally first.
- **Supabase Free keep-alive**: Free projects pause after 1 week of inactivity, which would break a live webhook. A daily cron on the VPS pings the database to keep it active.
- **Supabase Free limits** (500 MB DB, 1 GB Storage, 5 GB egress/month) are the sizing envelope. Music clips are pre-cut to stay small; generated Deliverables are **pruned after 30 days**, and can be re-rendered from the stored Composition on request.
- **Data store**: Supabase fully replaces local SQL Server Express. Postgres holds structured data; Supabase Storage holds binary content (images, clips, generated files) — not DB blob columns, as the old schema did.

### Stack and shape
- **Stack**: TypeScript throughout — the old Python scripts are reference only, not a migration target. FastAPI/Python fully dropped.
- **Storefront**: WooCommerce on self-hosted WordPress (see [ADR-0001](docs/adr/0001-self-hosted-wordpress.md)), not a custom-built shop. Backend integrates via signed WooCommerce webhooks and the WooCommerce REST API. The storefront itself is Dutch-only; the quiz Locale is a per-product option, not a bilingual site (no WPML/Polylang).
- **Repo**: single monorepo for WordPress-side code (wp-env config, any plugin glue) and the Next.js app.
- **App shape**: one Next.js (App Router) + Supabase app — API routes handle the WooCommerce webhook, a job worker runs generation, and a protected page in the same app is the admin UI. No separate admin app.
- **Local dev tooling (WordPress)**: `@wordpress/env` (`wp-env`) — Docker-based, driven as an npm devDependency + committed `.wp-env.json`. Ships WP-CLI in-container. Chosen over Local by Flywheel (no committed/reproducible config).
- **Dev parity**: local = `wp-env` + Supabase CLI + `next dev`; production = the same three pieces as Docker containers on the VPS (Supabase remains hosted).

### Generation and delivery
- **Generation trigger**: the WooCommerce webhook fires when an order reaches **`processing`** (payment received), not on raw order creation — avoids "spending" no-repeat Items on orders that never complete payment.
- **Job runner**: the webhook handler only validates the signature, records the order, enqueues one job per Quiz, and returns 200. Generation runs in a `pg-boss` worker (Postgres-backed job queue, retries, per-quiz isolation) inside the Next.js container — see [ADR-0005](docs/adr/0005-pg-boss-job-queue.md). No execution-time cap, no Vercel Workflow.
- **Pipeline orthogonality**: three independent modules with one-way data flow — **sample** (Items → Composition; knows nothing about files or orders), **render** (Composition → Deliverables; one renderer per Deliverable, knows nothing about orders), **deliver** (Deliverables → WooCommerce; knows nothing about Items). All three Item kinds go through the same sampling code path.
- **PDF generation**: `@react-pdf/renderer`, not `pdf-lib` (see [ADR-0002](docs/adr/0002-pdf-generation-library.md)).
- **Audio generation**: `ffmpeg` (system package in the container, `ffmpeg-static` locally) for concatenation + loudness normalisation only.
- **Delivery**: the backend uploads the Deliverables to Storage, attaches their URLs to the order as WooCommerce downloadable files via the REST API, and sets the order to **`completed`**. WooCommerce's own completed-order email then delivers the download links — no separate email service or template. Fallback access is WooCommerce's My Account → Downloads. Failed generation (see Generation failure policy) means the order stays `processing` and the operator is alerted; nothing goes to the customer.
- **Multi-quiz orders**: one order can contain multiple Quizzes as distinct, independently-configured line items (each with its own Locale/category/difficulty/mode) — not a quantity multiplier. Each is its own job.
- **Checkout config capture**: per-quiz configuration (Locale, category picks, difficulty, mode) is captured with an existing WooCommerce add-ons plugin where possible, landing in `line_items[].meta_data` (present in the webhook payload — no custom storage). Hand-rolled checkout fields only if an add-ons plugin can't meet a real requirement.

### Content model
- **Category hierarchy**: strictly nested 3 levels — Category → Subcategory → Subsubcategory, each with exactly one parent. No deeper nesting planned. Names are translated per Locale.
- **Item storage shape**: a shared `items` base table (id, type, Subsubcategory FK, Difficulty) joined 1:1 to type-specific detail tables (`picture_item_details`, `music_item_details`) and 1:N to `item_translations(item_id, locale, question, answer, fact)`. Text Items have no detail table — their whole payload (question, answer, Fact) lives in `item_translations`. Not one flat table with nullable per-type columns. Keeps sampling uniform across types while letting payloads diverge (e.g. Music Items carry artist/title/clip path, never question text).
- **Difficulty**: two separate enums. `Item.difficulty` is `easy | medium | hard` (exactly one, fixed per Item). The customer-facing **requested difficulty** on a Quiz is `easy | medium | hard | mixed`. `mixed` draws 4/3/3 across the three levels per Round, with which level gets the fourth slot chosen at random. Difficulty is chosen once per Quiz, not per Round.

### Admin UI
- **Scope**: full CRUD on Category/Subcategory/Subsubcategory (delete blocked while any Item references it — hard block, no cascade) and on all three Item types, including in-place file replacement for Picture/Music (swap the Storage file, keep the `item_id`). Translations are edited on the same Item/Category form, one tab or column per Locale. Composition / delivery history per billing email is read-only, for support lookups — no manual un-exclude.
- **UI language**: code, identifiers, commits, and schema are English. UI strings are Dutch by default with a switch to English, via `next-intl` message files — never hardcoded in components.

### Marketing
- **Organic first**: no paid ads and no autonomous ads agent. Marketing scope for now is SEO-friendly product pages and copy on the WordPress site; anything agent-assisted (drafting posts, copy) stays human-approved and free of recurring cost.
