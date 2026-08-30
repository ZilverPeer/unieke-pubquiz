# Pubquiz — Domain Glossary

## Terms

**Content** — actual quiz material: question/answer rows, image files (picture rounds, flags), audio files (music rounds), and any PDF exports containing real quiz data. Lives in Supabase (Postgres tables + Storage buckets), never committed to git.

**Code** — application logic, schema/DDL definitions (no data rows), and configuration. Lives in the GitHub repo.

## Decisions

- **Data store**: Supabase fully replaces local SQL Server Express. Postgres holds structured data (questions, categories, difficulty, metadata); Supabase Storage holds binary content (images, PDFs, audio) — not DB blob columns, as the old schema did.
- **Stack**: rebuild the fulfillment backend in TypeScript (not Python) — the old Python scripts are reference only, not a migration target.
- **Storefront**: WooCommerce on self-hosted WordPress (see [ADR-0001](docs/adr/0001-self-hosted-wordpress.md)), not a custom-built shop. Backend integrates via signed WooCommerce webhooks.
- **Hosting**: WordPress and the TS backend run on separate hosts (decoupled uptime/scaling), each with local dev parity required (WordPress local env + Supabase CLI local + normal TS dev server).
- **Repo**: single monorepo for WordPress-side code and the TS backend, following the same shape as the user's SparkStock project.
- **App shape**: one Next.js (App Router) + Supabase app — API routes handle the WooCommerce webhook and generation logic, a protected page within the same app is the admin UI for managing questions/images/sounds/facts. No separate admin app.
- **FastAPI/Python fully dropped.** No Python component in the rebuilt system; old scripts are reference-only, not ported.
