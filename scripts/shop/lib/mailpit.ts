import { spawnSync } from "node:child_process";
import { MAILPIT_CONTAINER, MAILPIT_IMAGE, MAILPIT_UI_PORT, MAILPIT_SMTP_PORT } from "./config";

function docker(args: string[]): { stdout: string; status: number } {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  return { stdout: (result.stdout ?? "").trim(), status: result.status ?? 1 };
}

/**
 * Starts the Mailpit mail-catcher container (idempotently) that wp-env's
 * WordPress container sends mail to via SMTP -- see
 * shop/mu-plugins/pubquiz-mailpit-smtp.php and shop/README.md for why this
 * substitutes for Supabase's Inbucket (unreachable from wp-env's network).
 */
export function ensureMailpit(): { uiUrl: string } {
  const running = docker(["ps", "--filter", `name=^${MAILPIT_CONTAINER}$`, "--format", "{{.Names}}"]);
  if (running.stdout.split("\n").includes(MAILPIT_CONTAINER)) {
    return { uiUrl: `http://127.0.0.1:${MAILPIT_UI_PORT}` };
  }

  const stopped = docker(["ps", "-a", "--filter", `name=^${MAILPIT_CONTAINER}$`, "--format", "{{.Names}}"]);
  if (stopped.stdout.split("\n").includes(MAILPIT_CONTAINER)) {
    docker(["start", MAILPIT_CONTAINER]);
    return { uiUrl: `http://127.0.0.1:${MAILPIT_UI_PORT}` };
  }

  const run = docker([
    "run",
    "-d",
    "--name",
    MAILPIT_CONTAINER,
    "-p",
    `${MAILPIT_UI_PORT}:8025`,
    "-p",
    `${MAILPIT_SMTP_PORT}:1025`,
    MAILPIT_IMAGE,
  ]);
  if (run.status !== 0) {
    throw new Error(`Failed to start Mailpit container (${MAILPIT_CONTAINER}).`);
  }
  return { uiUrl: `http://127.0.0.1:${MAILPIT_UI_PORT}` };
}

/** Stops (but does not remove) the Mailpit container, if running. */
export function stopMailpit(): void {
  docker(["stop", MAILPIT_CONTAINER]);
}
