/**
 * Shared paths/URLs for the local loop (ticket #59): `npm run loop:up` /
 * `npm run loop:down`.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAILPIT_UI_PORT, WP_ENV_PORT } from "../../shop/lib/config";

// Derived from import.meta.url rather than __dirname, same reasoning as
// scripts/shop/lib/env-file.ts: this file runs both directly (via tsx) and
// imported, and the repo is ESM (`"type": "module"` in package.json).
const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(__dirname, "..", "..", "..");

export const LOCAL_DIR = join(REPO_ROOT, ".local");
export const NEXT_DEV_LOG_PATH = join(LOCAL_DIR, "next-dev.log");
export const NEXT_DEV_PID_PATH = join(LOCAL_DIR, "next-dev.pid");

export const APP_PORT = 3000;
export const APP_URL = `http://localhost:${APP_PORT}`;
// Built from the shop's own port constants (scripts/shop/lib/config.ts)
// rather than repeated literals, so a port change there can't silently
// desync the loop's printed URLs.
export const SHOP_URL = `http://localhost:${WP_ENV_PORT}`;
export const MAILPIT_URL = `http://127.0.0.1:${MAILPIT_UI_PORT}`;

export const APP_START_TIMEOUT_MS = 120_000;
export const APP_POLL_INTERVAL_MS = 2_000;
