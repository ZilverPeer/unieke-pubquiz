/**
 * Persists `setup.ts`'s parsed `SetupResult` (ticket #67) to the gitignored
 * `.local/shop-setup.json`, through the existing `SetupResult` shape --
 * unlike `.env.local` (see env-file.ts), which only gets the REST API
 * credentials, this file is the one place `npm run loop:up` -- a separate
 * process, run after `npm run shop:up` (and so `setup.ts`) has already
 * exited -- can read the product id and build the "Add to cart" URL
 * (ticket #67) without re-running any WP-CLI call. `.local/` is gitignored
 * (same protection level as `.env.local`), so persisting the full shape,
 * consumerKey/consumerSecret included, is no worse than what `.env.local`
 * already stores.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SetupResult } from "./setup-result";

// Runs both as an ESM script (via tsx, no __dirname) and imported by
// setup.ts/up.ts the same way -- derive the directory from
// import.meta.url rather than relying on the CommonJS-only __dirname, same
// as env-file.ts and scripts/loop/lib/config.ts.
const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCAL_DIR = join(__dirname, "..", "..", "..", ".local");
export const SETUP_RESULT_FILE_PATH = join(LOCAL_DIR, "shop-setup.json");

export function writeSetupResultFile(result: SetupResult): void {
  if (!existsSync(LOCAL_DIR)) mkdirSync(LOCAL_DIR, { recursive: true });
  writeFileSync(SETUP_RESULT_FILE_PATH, JSON.stringify(result, null, 2), "utf8");
}

/**
 * Reads back what `writeSetupResultFile` wrote. Throws (rather than
 * returning null) on a missing or unparsable file: a caller needing this
 * (currently only `loop:up`, after `shop:up` has already run) has no
 * sensible fallback -- there is no product id to print -- so failing fast
 * with a clear cause beats printing nothing or a stale value.
 */
export function readSetupResultFile(): SetupResult {
  if (!existsSync(SETUP_RESULT_FILE_PATH)) {
    throw new Error(
      `${SETUP_RESULT_FILE_PATH} does not exist -- expected "npm run shop:up" to have written it just now.`,
    );
  }
  const contents = readFileSync(SETUP_RESULT_FILE_PATH, "utf8");
  try {
    return JSON.parse(contents) as SetupResult;
  } catch {
    throw new Error(`${SETUP_RESULT_FILE_PATH} did not contain valid JSON.`);
  }
}
