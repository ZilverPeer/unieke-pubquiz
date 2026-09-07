/**
 * Shared paths/URLs for the local loop (ticket #59): `npm run loop:up` /
 * `npm run loop:down`.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Derived from import.meta.url rather than __dirname, same reasoning as
// scripts/shop/lib/env-file.ts: this file runs both directly (via tsx) and
// imported, and the repo is ESM (`"type": "module"` in package.json).
const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(__dirname, "..", "..", "..");

export const LOCAL_DIR = join(REPO_ROOT, ".local");
export const NEXT_DEV_LOG_PATH = join(LOCAL_DIR, "next-dev.log");
export const NEXT_DEV_PID_PATH = join(LOCAL_DIR, "next-dev.pid");

export const APP_URL = "http://localhost:3000";
export const SHOP_URL = "http://localhost:45330";
export const MAILPIT_URL = "http://127.0.0.1:45332";

export const APP_START_TIMEOUT_MS = 120_000;
export const APP_POLL_INTERVAL_MS = 2_000;
