import { spawnSync } from "node:child_process";
import { CRON_TICKER_CONTAINER, CRON_TICKER_IMAGE, CRON_TICKER_INTERVAL_SECONDS, WP_ENV_PORT } from "./config";

function docker(args: string[]): { stdout: string; status: number } {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  return { stdout: (result.stdout ?? "").trim(), status: result.status ?? 1 };
}

/**
 * Builds the shell command the ticker container's `sh -c` runs: a loop that
 * requests `wp-cron.php` every `intervalSeconds`, discarding output, and
 * never exiting even when a single request fails (`|| true`) -- see
 * ensureCronTicker's docblock for why this exists.
 */
export function buildCronTickerShellCommand(options: { wpEnvPort: number; intervalSeconds: number }): string {
  const { wpEnvPort, intervalSeconds } = options;
  return (
    `while true; do curl -s -o /dev/null http://host.docker.internal:${wpEnvPort}/wp-cron.php?doing_wp_cron || true; ` +
    `sleep ${intervalSeconds}; done`
  );
}

/**
 * Starts a small `curlimages/curl` container (idempotently) that ticks
 * WordPress's cron (`wp-cron.php`) every few seconds -- wp-env's WordPress
 * only runs its cron on HTTP traffic, and Action Scheduler (which delivers
 * the `order.updated` webhook) needs that tick to fire without a manual
 * `wp action-scheduler run` after every order (ticket #58, see
 * docs/runbook-local-loop.md). Same idempotency shape as
 * scripts/shop/lib/mailpit.ts: a running container is reused, a stopped one
 * restarted, an absent one created.
 */
export function ensureCronTicker(): { containerName: string } {
  const running = docker(["ps", "--filter", `name=^${CRON_TICKER_CONTAINER}$`, "--format", "{{.Names}}"]);
  if (running.stdout.split("\n").includes(CRON_TICKER_CONTAINER)) {
    return { containerName: CRON_TICKER_CONTAINER };
  }

  const stopped = docker(["ps", "-a", "--filter", `name=^${CRON_TICKER_CONTAINER}$`, "--format", "{{.Names}}"]);
  if (stopped.stdout.split("\n").includes(CRON_TICKER_CONTAINER)) {
    docker(["start", CRON_TICKER_CONTAINER]);
    return { containerName: CRON_TICKER_CONTAINER };
  }

  const shellCommand = buildCronTickerShellCommand({
    wpEnvPort: WP_ENV_PORT,
    intervalSeconds: CRON_TICKER_INTERVAL_SECONDS,
  });
  const run = docker(["run", "-d", "--name", CRON_TICKER_CONTAINER, CRON_TICKER_IMAGE, "sh", "-c", shellCommand]);
  if (run.status !== 0) {
    throw new Error(`Failed to start cron ticker container (${CRON_TICKER_CONTAINER}).`);
  }
  return { containerName: CRON_TICKER_CONTAINER };
}
