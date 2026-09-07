/**
 * Upserts the WooCommerce REST API credentials `npm run shop:up` gets back
 * from setup-shop.php into the repo root's gitignored `.env.local` -- the
 * one file Next.js (`next dev`), the tsx dev scripts (via
 * `scripts/load-env.ts`) and the vitest integration suite all load, so there
 * is exactly one place these three values live locally. See
 * shop/README.md ("REST credentials") and README.md "Environment
 * variables". Split out of the former lib/rest-api-key.ts (ticket #61):
 * that file's `wp eval-file` call moved into setup-shop.php, this part -- a
 * plain file write, no WP-CLI involved -- stays in Node.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This file runs both as an ESM script (via tsx, no __dirname) and is
// imported by setup.ts the same way -- derive the directory from
// import.meta.url rather than relying on the CommonJS-only __dirname.
const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = join(__dirname, "..", "..", "..", ".env.local");

export interface RestApiCredentials {
  url: string;
  consumerKey: string;
  consumerSecret: string;
}

/** Replaces (or appends) a `KEY=value` line in a dotenv file's contents, preserving everything else. */
function upsertEnvLine(contents: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(contents)) return contents.replace(pattern, line);
  const withTrailingNewline = contents.length > 0 && !contents.endsWith("\n") ? `${contents}\n` : contents;
  return `${withTrailingNewline}${line}\n`;
}

/** Upserts WOOCOMMERCE_URL / WOOCOMMERCE_CONSUMER_KEY / WOOCOMMERCE_CONSUMER_SECRET into `.env.local`, leaving every other line (including a developer's own settings) untouched. */
export function upsertRestApiCredentials(credentials: RestApiCredentials): void {
  let contents = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  contents = upsertEnvLine(contents, "WOOCOMMERCE_URL", credentials.url);
  contents = upsertEnvLine(contents, "WOOCOMMERCE_CONSUMER_KEY", credentials.consumerKey);
  contents = upsertEnvLine(contents, "WOOCOMMERCE_CONSUMER_SECRET", credentials.consumerSecret);
  writeFileSync(ENV_FILE, contents, "utf8");
}
