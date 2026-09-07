import { describe, expect, test } from "vitest";
import { buildCronTickerShellCommand } from "./cron-ticker";

/**
 * Unit seam for ticket #58's cron ticker: the pure builder that turns a
 * WordPress port and a tick interval into the shell command the
 * `curlimages/curl` container runs in a loop. The container itself (start,
 * reuse, restart) is verified empirically against Docker per the ticket
 * brief, not here -- see scripts/shop/lib/cron-ticker.ts.
 */
describe("buildCronTickerShellCommand", () => {
  test("loops curl against wp-cron.php on the given port at the given interval, discarding output, never exiting on a failed request", () => {
    const command = buildCronTickerShellCommand({ wpEnvPort: 45330, intervalSeconds: 5 });

    expect(command).toBe(
      "while true; do curl -s -o /dev/null http://host.docker.internal:45330/wp-cron.php?doing_wp_cron || true; sleep 5; done",
    );
  });

  test("uses the given port and interval, not hardcoded ones", () => {
    const command = buildCronTickerShellCommand({ wpEnvPort: 12345, intervalSeconds: 9 });

    expect(command).toBe(
      "while true; do curl -s -o /dev/null http://host.docker.internal:12345/wp-cron.php?doing_wp_cron || true; sleep 9; done",
    );
  });
});
