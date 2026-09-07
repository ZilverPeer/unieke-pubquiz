/**
 * Creates the WooCommerce REST API key `npm run shop:up` needs for the
 * deliver module (ticket #41) and upserts it into the repo root's
 * `.env.local` -- the one file Next.js (`next dev`), the tsx dev scripts
 * (via `scripts/load-env.ts`) and the vitest integration suite all load, so
 * there is exactly one place these three values live locally. See
 * shop/README.md ("REST credentials") and README.md "Environment
 * variables".
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WP_ENV_PORT } from "./config";
import { wpCli } from "./wp-cli";

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

/**
 * Runs create-rest-api-key.php (deletes+recreates the "pubquiz-pipeline" key
 * every time -- see that file's docblock for why reuse isn't possible) and
 * upserts WOOCOMMERCE_URL / WOOCOMMERCE_CONSUMER_KEY / WOOCOMMERCE_CONSUMER_SECRET
 * into `.env.local`, leaving every other line (including a developer's own
 * settings) untouched.
 */
export function ensureRestApiKey(): RestApiCredentials {
  const { stdout } = wpCli(["eval-file", "wp-content/mu-plugins/wp-cli-scripts/create-rest-api-key.php"]);
  const [consumerKey, consumerSecret] = stdout.trim().split("|");
  if (!consumerKey || !consumerSecret) {
    throw new Error(`Could not parse REST API key output from create-rest-api-key.php: "${stdout}"`);
  }

  const url = `http://localhost:${WP_ENV_PORT}`;
  let contents = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  contents = upsertEnvLine(contents, "WOOCOMMERCE_URL", url);
  contents = upsertEnvLine(contents, "WOOCOMMERCE_CONSUMER_KEY", consumerKey);
  contents = upsertEnvLine(contents, "WOOCOMMERCE_CONSUMER_SECRET", consumerSecret);
  writeFileSync(ENV_FILE, contents, "utf8");

  return { url, consumerKey, consumerSecret };
}
