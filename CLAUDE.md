@AGENTS.md

## Start here

- `CONTEXT.md` is the domain and decision source of truth; `docs/adr/` records the why behind hard-to-reverse choices. Read them before designing anything. When a decision changes, update `CONTEXT.md` in the same change — never let docs and code disagree.
- This repo shares nothing with SparkStock. Do not apply SparkStock rules, skills, or conventions here.

## Build philosophy

Prefer well-established, off-the-shelf/third-party solutions (platform features, mainstream libraries) over hand-rolling functionality that's already been solved many times over — e.g. WooCommerce's native downloadable-products feature over a custom download portal. Treat a custom build as the thing that needs justifying, not the default. Applies especially to things like auth/user management, payments, and file delivery.

## Hard constraints

- **No new recurring cost.** The single VPS is the only accepted paid infrastructure. Everything else runs on free tiers. Before adding a service, dependency with a hosted component, or plan upgrade, state the cost and ask.
- **Content never enters git.** Quiz questions, images, audio clips, and generated deliverables live in Supabase only (see `.gitignore`). Static app assets (announcement audio, logos) are code and may be committed.
- **English code, Dutch-first UI.** Identifiers, schema, comments, and commits are English. Every admin UI string goes through `next-intl` message files (`nl` default, `en` available); never hardcode user-facing text in components.

## Architecture rules

- **Orthogonal pipeline.** `sample` (Items → Composition), `render` (Composition → Deliverables), and `deliver` (Deliverables → WooCommerce) are separate modules with one-way data flow. Sampling never touches files or orders; renderers never touch orders; delivery never touches Items. No cross-imports between them.
- **DRY across Item kinds.** Text, Picture, and Music Items share one base table, one sampling path, and one translation pattern. Type-specific code lives only in detail tables and in the renderer that needs it.
- **Locale is data, not code.** Never branch on `nl`/`en` in logic; look up the translation for the requested locale and fail generation if it is missing.
