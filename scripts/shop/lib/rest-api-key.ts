/**
 * Creates the WooCommerce REST API key `npm run shop:up` needs for the
 * deliver module (ticket #41) and writes it to a gitignored `.env.shop.local`
 * at the repo root. See shop/README.md ("REST credentials").
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WP_ENV_PORT } from "./config";
import { wpCli } from "./wp-cli";

// This file runs both as an ESM script (via tsx, no __dirname) and is
// imported by setup.ts the same way -- derive the directory from
// import.meta.url rather than relying on the CommonJS-only __dirname.
const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = join(__dirname, "..", "..", "..", ".env.shop.local");

export interface RestApiCredentials {
  url: string;
  consumerKey: string;
  consumerSecret: string;
}

/**
 * Runs create-rest-api-key.php (deletes+recreates the "pubquiz-pipeline" key
 * every time -- see that file's docblock for why reuse isn't possible) and
 * writes WOOCOMMERCE_URL / WOOCOMMERCE_CONSUMER_KEY / WOOCOMMERCE_CONSUMER_SECRET
 * to .env.shop.local.
 */
export function ensureRestApiKey(): RestApiCredentials {
  const { stdout } = wpCli(["eval-file", "wp-content/mu-plugins/wp-cli-scripts/create-rest-api-key.php"]);
  const [consumerKey, consumerSecret] = stdout.trim().split("|");
  if (!consumerKey || !consumerSecret) {
    throw new Error(`Could not parse REST API key output from create-rest-api-key.php: "${stdout}"`);
  }

  const url = `http://localhost:${WP_ENV_PORT}`;
  const contents = [
    "# Written by `npm run shop:up` (scripts/shop/lib/rest-api-key.ts). Do not commit -- see .gitignore.",
    `WOOCOMMERCE_URL=${url}`,
    `WOOCOMMERCE_CONSUMER_KEY=${consumerKey}`,
    `WOOCOMMERCE_CONSUMER_SECRET=${consumerSecret}`,
    "",
  ].join("\n");
  writeFileSync(ENV_FILE, contents, "utf8");

  return { url, consumerKey, consumerSecret };
}
