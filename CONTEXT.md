# Pubquiz — Domain Glossary

## Terms

**Content** — actual quiz material: question/answer rows, image files (picture rounds, flags), audio files (music rounds), and any PDF exports containing real quiz data. Lives in Supabase (Postgres tables + Storage buckets), never committed to git.

**Code** — application logic, schema/DDL definitions (no data rows), and configuration. Lives in the GitHub repo.

**Category** — a broad subject a question belongs to, e.g. "Sports", "History", "Music".

**Subcategory** — a narrower slice within one Category, e.g. "Sports" → "Football".

**Subsubcategory** — the most granular bucket, nested under one Subcategory, e.g. "Football" → "World Cup". This is the unit used for the round-composition anti-repetition rule (a round may not contain two questions from the same Subsubcategory).

**Item** — the atomic, sampleable unit of quiz content. Three kinds exist — Text Item (question + answer), Picture Item (single image), Music Item (single audio track) — and all three carry the same Category/Subcategory/Subsubcategory/Difficulty shape and are sampled the same way. Distinct from a **Round** (see below): an Item is one piece of content; a Round is the assembled section of a quiz built from several Items.

**Fact** — an optional single text blurb on an Item, shown after the answer is revealed (e.g. "this photo was taken in 1969"). Not required, not multi-valued, not its own entity — a nullable field on the Item.

**Round** — one themed section of a generated quiz, composed from multiple Items of one kind (a Text Round from Text Items, a Picture Round from Picture Items, a Music Round from Music Items). Picture Rounds insert a fixed count of Picture Items (currently 10) into a styled PDF template. Music Rounds combine multiple Music Items into a single playable track — today built manually; dynamic composition is a stated future goal, not yet in scope.

**Quiz** — the generated deliverable for one order: a fixed structure of 8 Round slots — 6 Text Rounds + 1 Picture Round + 1 Music Round — each slot themed around exactly one Category. The customer may explicitly assign a Category to any subset of the 8 slots (any round type, not just Text); any slots left unassigned are filled with a randomly-chosen Category.

Every Round — Text, Picture, or Music — contains exactly 10 Items. (60 Text Items total across the 6 Text Rounds, 10 Picture Items, 10 Music Items.)

A Quiz has a **Quiz mode**: `mixed` (the default flow above — up to 8 customer-picked Categories, unique across all 8 slots, rest randomized) or `single_category` (all 8 slots use one customer-chosen Category — the uniqueness rule doesn't apply here, it's a different mode, not an exception to it).

**No-repeat rule**: a customer never receives the same Item twice across their full order history — unbounded (no "last N orders" cutoff, no per-category scoping). Sampling for a new order excludes every Item already delivered to that customer in any past order. "Customer" is identified by **billing email**, not WooCommerce account ID — this covers guest checkouts too, since WooCommerce always captures a billing email regardless of account status.

**Generation failure policy**: if a Round can't be filled to its full 10 Items after applying the no-repeat and no-duplicate-Subsubcategory rules, generation hard-fails and alerts the operator — it never silently ships a short/degraded round. (The legacy system did the opposite: logged a warning and shipped fewer questions anyway — a known bug pattern this rebuild explicitly avoids.)

**Physical Quiz delivery** *(future, not building now)* — an option for a customer to receive a printed, mailed copy of their Quiz instead of (or alongside) digital delivery. The generated content is identical either way (same Item sampling, same `@react-pdf/renderer` PDF) — this only affects the fulfillment path (shippable WooCommerce product + a print/mail step) and would add a shipping address requirement, not the generation pipeline. Flagged so the digital-only Delivery decision above isn't accidentally treated as a permanent constraint.

**Curated Quiz** *(future, not building now)* — a themed/preset quiz (e.g. a "Year in Review" product) that is fully fixed: not just categories but the exact Items in each round, set in stone rather than sampled. Structurally different from a normal Quiz (no sampling at all) — flagged here so schema/generation code isn't accidentally designed in a way that forecloses it, but not in scope for the current build.

## Decisions

- **Data store**: Supabase fully replaces local SQL Server Express. Postgres holds structured data (questions, categories, difficulty, metadata); Supabase Storage holds binary content (images, PDFs, audio) — not DB blob columns, as the old schema did.
- **Stack**: rebuild the fulfillment backend in TypeScript (not Python) — the old Python scripts are reference only, not a migration target.
- **Storefront**: WooCommerce on self-hosted WordPress (see [ADR-0001](docs/adr/0001-self-hosted-wordpress.md)), not a custom-built shop. Backend integrates via signed WooCommerce webhooks.
- **Hosting**: WordPress and the TS backend run on separate hosts (decoupled uptime/scaling), each with local dev parity required (WordPress local env + Supabase CLI local + normal TS dev server).
- **Repo**: single monorepo for WordPress-side code and the TS backend, following the same shape as the user's SparkStock project.
- **App shape**: one Next.js (App Router) + Supabase app — API routes handle the WooCommerce webhook and generation logic, a protected page within the same app is the admin UI for managing questions/images/sounds/facts. No separate admin app.
- **FastAPI/Python fully dropped.** No Python component in the rebuilt system; old scripts are reference-only, not ported.
- **PDF generation**: `@react-pdf/renderer`, not `pdf-lib` (see [ADR-0002](docs/adr/0002-pdf-generation-library.md)).
- **Delivery**: once generation succeeds, the finished quiz (PDF + audio) is emailed automatically to the order's billing address, *and* made available as a fallback via WooCommerce's own built-in downloadable-products feature (My Account → Downloads) — the backend attaches the generated file's URL to the order via the WooCommerce REST API rather than building a separate customer-facing portal page in the Next.js app. Failed generation (see Generation failure policy) means neither the email nor the download link goes out.
- **Generation trigger**: the WooCommerce webhook triggers generation when an order reaches **`processing`** status (payment received), not on raw order creation — avoids generating (and "spending" no-repeat items) for orders that never complete payment.
- **Multi-quiz orders**: one order can contain multiple Quizzes as distinct, independently-configured products/line items (each with its own category/difficulty/mode selections) — not a quantity multiplier on one configuration. (Build philosophy — prefer off-the-shelf solutions over hand-rolling — now lives in the repo's `CLAUDE.md`, not here.)
- **WordPress hosting provider**: deferred, not decided — self-hosted is locked in (ADR-0001), but no VPS/host chosen yet. Low priority: hobby-scale traffic, and Erik wants to build against localhost first, so this only needs deciding once there's something ready to deploy.
- **Local dev tooling (WordPress)**: `@wordpress/env` (`wp-env`) — the official WordPress-maintained CLI, Docker-based but driven as an npm devDependency + committed `.wp-env.json` config (reproducible from `git clone`, fits the monorepo alongside the Next.js side). Ships WP-CLI in-container by default, matching the WP-CLI/SSH-access requirement from the self-hosted decision. Chosen over Local by Flywheel (a standalone GUI app with no committed/reproducible config).
- **Admin UI scope**: the protected in-app page manages — full CRUD on Category/Subcategory/Subsubcategory (create/rename/delete; delete is blocked if any Item still references it — an edge case, but a hard block rather than cascade-delete or orphaning) and full CRUD on all three Item types (Text/Picture/Music), including in-place file replacement for Picture/Music (swap the Storage file, keep the same `item_id` so category/difficulty/Fact/delivery-history stay attached). Fact is edited as a plain field on the same Item form — no separate bulk-add tooling for now. Order-history / no-repeat delivery data (which Items have gone to which billing email) is read-only in the admin UI, shown for support lookups only — no manual override/un-exclude action.
- **Checkout config capture**: per-quiz configuration (category picks, difficulty, mode) is captured at checkout using an existing WooCommerce add-ons plugin (e.g. the official Product Add-Ons extension or a free equivalent) where possible, landing in WooCommerce's native `line_items[].meta_data` (confirmed present in the REST API/webhook order payload — no custom storage needed). Hand-rolled custom checkout fields are the fallback only if an add-ons plugin can't meet a real requirement.
- **Category hierarchy**: strictly nested 3 levels — Category → Subcategory → Subsubcategory, each with exactly one parent (not tag-like/multi-parent). No deeper nesting planned.
- **Item storage shape**: a shared `items` base table (id, type, Category/Subcategory/Subsubcategory FK, Difficulty, Facts) joined 1:1 to type-specific detail tables (`text_item_details`, `picture_item_details`, `music_item_details`) — not one flat table with nullable per-type columns. Keeps sampling queries uniform across types while letting each type's payload diverge (e.g. Music Items will need combining/clip-range metadata that Text/Picture Items never will).
- **Difficulty**: two separate enums, not one. `Item.difficulty` is `easy | medium | hard` (always exactly one, fixed per item). The customer-facing **requested difficulty** on an order is `easy | medium | hard | mixed` — `mixed` means sampling draws an even split across all three difficulty levels (a deliberate variety, not an unconstrained/unbalanced draw). Difficulty is chosen once per quiz (quiz-wide), not per round or per item.
