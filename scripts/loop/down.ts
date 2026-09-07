/**
 * `npm run loop:down` (ticket #59): stops everything `npm run loop:up`
 * started, in reverse order. Every step is tolerant of "already stopped" --
 * this always exits zero.
 */
import { spawnSync } from "node:child_process";
import { deletePidFile, readPidFile } from "./lib/pidfile";
import { NEXT_DEV_PID_PATH, REPO_ROOT } from "./lib/config";

function killAppProcess(): void {
  const pid = readPidFile(NEXT_DEV_PID_PATH);
  if (pid === null) {
    console.log("App: no pid file, nothing to kill.");
    return;
  }

  console.log(`App: stopping pid ${pid}...`);
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

  deletePidFile(NEXT_DEV_PID_PATH);
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
