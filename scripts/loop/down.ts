/**
 * `npm run loop:down` (ticket #59): stops everything `npm run loop:up`
 * started, in reverse order. Every step is tolerant of "already stopped" --
 * this always exits zero.
 *
 * Fix round 1: a reviewer's first `loop:down` hit a stale pid file ("process
 * not found") and port 3000 was only closed by luck. After killing whatever
 * the pid file names (or noting why it couldn't), this also checks whether
 * port 3000 still has a listener and, if so, kills that owner's tree too --
 * see scripts/loop/lib/port-owner.ts for the platform-specific parsing.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { deletePidFile, readPidFile } from "./lib/pidfile";
import { parsePortOwnerFromLsof, parsePortOwnerFromNetstat } from "./lib/port-owner";
import { APP_PORT, NEXT_DEV_PID_PATH, REPO_ROOT } from "./lib/config";

/** Kills `pid` and its whole process tree -- tolerant of the pid already being gone. */
function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    // /T kills the whole process tree (next dev's own child processes),
    // /F forces it -- tolerant of the pid already being gone (non-zero
    // exit, ignored).
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "inherit" });
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // Already gone -- fine.
    }
  }
}

/**
 * The pid currently listening on `port`, or null -- Windows via `netstat`,
 * POSIX via `lsof`.
 *
 * Fix round 2: no longer pipes Windows' `netstat` through `findstr :PORT`
 * (a substring match that a port like 30000 also passes for port 3000) --
 * only `findstr LISTENING` narrows the rows here; the exact port match is
 * `parsePortOwnerFromNetstat`'s job, done on the real local-address column.
 */
function findPortOwnerPid(port: number): number | null {
  if (process.platform === "win32") {
    const result = spawnSync(`netstat -ano | findstr LISTENING`, {
      encoding: "utf8",
      shell: true,
    });
    return parsePortOwnerFromNetstat(result.stdout ?? "", port);
  }
  const result = spawnSync(`lsof -ti:${port}`, { encoding: "utf8", shell: true });
  return parsePortOwnerFromLsof(result.stdout ?? "");
}

function killAppProcess(): void {
  if (!existsSync(NEXT_DEV_PID_PATH)) {
    console.log("App: no pid file, nothing to kill.");
  } else {
    const pid = readPidFile(NEXT_DEV_PID_PATH);
    if (pid === null) {
      console.log("App: pid file present but unparseable, deleting it.");
      deletePidFile(NEXT_DEV_PID_PATH);
    } else {
      console.log(`App: stopping pid ${pid}...`);
      killProcessTree(pid);
      deletePidFile(NEXT_DEV_PID_PATH);
    }
  }

  // Belt and braces: the pid file's process may already be gone (stale pid,
  // reused by an unrelated process, etc) while something is still actually
  // listening on the app's port -- check and kill that owner too.
  const ownerPid = findPortOwnerPid(APP_PORT);
  if (ownerPid !== null) {
    console.log(`App: port ${APP_PORT} is still listening (pid ${ownerPid}, untracked), stopping it too...`);
    killProcessTree(ownerPid);
  }
}

function runShopDown(): void {
  console.log("Shop: running npm run shop:down...");
  spawnSync("npm run shop:down", { stdio: "inherit", shell: true, cwd: REPO_ROOT });
}

function stopSupabase(): void {
  console.log("Supabase: running npx supabase stop...");
  spawnSync("npx supabase stop", { stdio: "inherit", shell: true });
}

function main() {
  killAppProcess();
  runShopDown();
  stopSupabase();
  console.log("");
  console.log("Local loop is down.");
}

main();
