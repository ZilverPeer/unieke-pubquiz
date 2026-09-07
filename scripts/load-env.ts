/**
 * Loads `.env.local` from the repo root into `process.env`, the same file
 * Next.js loads automatically for `next dev`/`next start` (and therefore
 * the webhook route, the worker started from `src/instrumentation.ts`, and
 * the download route). `tsx`-run scripts and the integration test suite
 * are not Next.js processes, so they don't get that for free -- import
 * this module first (side-effect only, no exports) in any entry point that
 * needs `WOOCOMMERCE_*`, `SUPABASE_*`, or any other env var `npm run
 * shop:up` or a developer's own `.env.local` provides. See README.md
 * "Environment variables" and shop/README.md ("REST credentials").
 *
 * Uses `dotenv`'s default behaviour: existing `process.env` values are
 * never overwritten, so real shell-exported values (CI, a developer's own
 * `export WOOCOMMERCE_URL=...`) still win over `.env.local`.
 */
import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(repoRoot, ".env.local") });
