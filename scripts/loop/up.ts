/**
 * `npm run loop:up` (ticket #59): the one command for the whole local loop.
 * Never resets the database -- see "Seed check" below.
 *
 * 1. Supabase: `npx supabase status -o env`; if that fails (not running),
 *    `npx supabase start` (never `db reset`). Then checks the seed with one
 *    query on `categories` and exits non-zero, telling Erik to run
 *    `npm run db:reset` once, if it's empty -- the loop never resets on its
 *    own (see docs/agents/orchestration.md "Before dispatching").
 * 2. `npm run shop:up` (wp-env + Mailpit + the cron ticker, already
 *    idempotent -- see shop/README.md).
 * 3. The app with the worker: reused if `http://localhost:3000` already
 *    answers, otherwise spawned detached (`npx next dev`,
 *    `PUBQUIZ_WORKER=1`), stdout/stderr to `.local/next-dev.log`, its pid to
 *    `.local/next-dev.pid`, waited on (120s timeout).
 * 4. Prints the shop, Mailpit and app URLs, and the log path.
 *
 * Deliberately does NOT `import "../load-env"` (unlike scripts/shop/*.ts):
 * this file never reads `WOOCOMMERCE_*`/`SUPABASE_*` itself, and loading
 * `.env.local` here would freeze those values into *this* process's
 * `process.env` before step 2 rewrites the file -- the spawned `next dev`
 * child in step 3 is given `{ ...process.env, PUBQUIZ_WORKER: "1" }`, and an
 * explicitly-set env var always wins over Next.js's own dotenv loading (see
 * README.md "Environment variables"), so a stale, pre-rewrite REST API key
 * would otherwise leak into the freshly spawned app and 401 every delivery.
 * Verified empirically: with the import, a freshly placed order's Quiz
 * generated fine but every `deliverQuiz` attempt 401'd
 * (`woocommerce_rest_cannot_view`) even though the *current* `.env.local`
 * key worked fine via a manual `curl`; removing the import fixed it.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { createSupabaseClient, resolveLocalStackConfig } from "../../src/repository";
import { isPidAlive, type PidAliveDeps } from "./lib/pid-alive";
import { parseSupabaseStatusResult } from "./lib/supabase-status";
import { waitUntilUrlAnswers } from "./lib/wait-for-url";
import { deletePidFile, readPidFile, writePidFile } from "./lib/pidfile";
import {
  APP_POLL_INTERVAL_MS,
  APP_START_TIMEOUT_MS,
  APP_URL,
  LOCAL_DIR,
  MAILPIT_URL,
  NEXT_DEV_LOG_PATH,
  NEXT_DEV_PID_PATH,
  REPO_ROOT,
  SHOP_URL,
} from "./lib/config";

function ensureSupabaseUp(): void {
  // A single command string (not execFileSync + shell:true), same reasoning
  // as src/repository/local-stack-config.ts: it's a fixed literal, letting
  // Node resolve the `npx` .cmd shim on Windows without a shell-injection
  // warning.
  const statusResult = spawnSync("npx supabase status -o env", {
    encoding: "utf8",
    shell: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const status = parseSupabaseStatusResult({ status: statusResult.status, stdout: statusResult.stdout ?? "" });

  if (status.running) {
    console.log("Supabase: already running.");
    return;
  }

  console.log("Supabase: not running, starting it (npx supabase start)...");
  const startResult = spawnSync("npx supabase start", { stdio: "inherit", shell: true });
  if (startResult.status !== 0) {
    throw new Error("npx supabase start failed -- see the output above.");
  }
}

async function ensureSeeded(): Promise<void> {
  const client = createSupabaseClient(resolveLocalStackConfig());
  const { count, error } = await client.from("categories").select("id", { count: "exact", head: true });
  if (error) {
    throw new Error(`Could not query the local Supabase stack's "categories" table: ${error.message}`);
  }
  if (!count) {
    throw new Error(
      'The local Supabase stack has no Categories seeded. This loop never resets the database on its own -- ' +
        'run "npm run db:reset" once, then re-run "npm run loop:up".',
    );
  }
  console.log(`Supabase: seed looks present (${count} Categories).`);
}

function runShopUp(): void {
  console.log("Shop: running npm run shop:up...");
  const result = spawnSync("npm run shop:up", { stdio: "inherit", shell: true, cwd: REPO_ROOT });
  if (result.status !== 0) {
    throw new Error("npm run shop:up failed -- see the output above.");
  }
}

/** Real platform probes for `isPidAlive` -- `tasklist` is only spawned on win32, `posixProbe` only called elsewhere. */
function pidAliveDeps(): PidAliveDeps {
  return {
    platform: process.platform,
    tasklist: (pid) => spawnSync("tasklist", ["/FI", `PID eq ${pid}`], { encoding: "utf8" }).stdout ?? "",
    posixProbe: (pid) => {
      process.kill(pid, 0);
      return true;
    },
  };
}

/**
 * If `.local/next-dev.pid` names a pid that's no longer alive, deletes it
 * (printing why) so callers don't act on stale state. Returns the still-live
 * pid, or null if there wasn't one.
 */
function reconcilePidFile(): number | null {
  const pid = readPidFile(NEXT_DEV_PID_PATH);
  if (pid === null) return null;
  if (isPidAlive(pid, pidAliveDeps())) return pid;
  console.log(`App: pid file named pid ${pid}, which is no longer alive, deleting it.`);
  deletePidFile(NEXT_DEV_PID_PATH);
  return null;
}

async function ensureAppUp(): Promise<void> {
  const alreadyUp = await waitUntilUrlAnswers(APP_URL, { timeoutMs: 1, intervalMs: 1 });
  if (alreadyUp) {
    console.log(`App: ${APP_URL} already answers, reusing it.`);
    // Never leave a stale pid file behind a reused app: either it still
    // names a live process (fine, leave it), or it doesn't and reconciling
    // deletes it with a printed note.
    reconcilePidFile();
    return;
  }

  const trackedPid = reconcilePidFile();
  if (trackedPid !== null) {
    console.log(
      `App: pid file names a live process (pid ${trackedPid}) that hasn't answered on ${APP_URL} yet -- ` +
        "waiting instead of starting a second one...",
    );
    const answered = await waitUntilUrlAnswers(APP_URL, {
      timeoutMs: APP_START_TIMEOUT_MS,
      intervalMs: APP_POLL_INTERVAL_MS,
    });
    if (!answered) {
      throw new Error(
        `${APP_URL} did not answer within ${APP_START_TIMEOUT_MS / 1000}s even though pid ${trackedPid} is alive. ` +
          `Check ${NEXT_DEV_LOG_PATH} for the reason.`,
      );
    }
    console.log(`App: ${APP_URL} is up (pid ${trackedPid}).`);
    return;
  }

  if (!existsSync(LOCAL_DIR)) mkdirSync(LOCAL_DIR, { recursive: true });

  console.log(`App: starting "npx next dev" detached (log: ${NEXT_DEV_LOG_PATH})...`);
  const logFd = openSync(NEXT_DEV_LOG_PATH, "a");
  // Spawned as `node <next's own bin script>` rather than `npx next dev`
  // (with or without shell: true): verified empirically that a detached
  // spawn through npx's .cmd shim on Windows exits 0 but silently drops
  // everything written to the fd-based stdio given here -- npx.cmd itself
  // spawns a further node.exe, and that extra layer of process creation
  // does not carry the inherited file handles through when the outermost
  // process is detached (plain `cmd /c echo` or `cmd /c npx --version`
  // without detached both work fine; only detached + npx's nested spawn
  // loses the output). Resolving next's own bin script and running it
  // directly under `process.execPath` avoids both cmd.exe and npx.
  const nextBin = join(REPO_ROOT, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "dev"], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, PUBQUIZ_WORKER: "1" },
  });
  if (child.pid === undefined) {
    throw new Error("Failed to spawn npx next dev.");
  }
  writePidFile(NEXT_DEV_PID_PATH, child.pid);
  child.unref();

  const answered = await waitUntilUrlAnswers(APP_URL, {
    timeoutMs: APP_START_TIMEOUT_MS,
    intervalMs: APP_POLL_INTERVAL_MS,
  });
  if (!answered) {
    throw new Error(
      `${APP_URL} did not answer within ${APP_START_TIMEOUT_MS / 1000}s. Check ${NEXT_DEV_LOG_PATH} for the reason.`,
    );
  }
  console.log(`App: ${APP_URL} is up (pid ${child.pid}).`);
}

async function main() {
  ensureSupabaseUp();
  await ensureSeeded();
  runShopUp();
  await ensureAppUp();

  console.log("");
  console.log("Local loop is up:");
  console.log(`  Shop:     ${SHOP_URL}`);
  console.log(`  Mailpit:  ${MAILPIT_URL}`);
  console.log(`  App:      ${APP_URL}`);
  console.log(`  App log:  ${NEXT_DEV_LOG_PATH}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode ||= 1;
});
