import { describe, expect, test } from "vitest";
import { parsePortOwnerFromLsof, parsePortOwnerFromNetstat } from "./port-owner";

/**
 * Unit seam for fix round 1 on ticket #59: `loop:down` kills the app's
 * tracked pid, but a reviewer hit a stale pid file ("process not found")
 * that left port 3000 held by a different, untracked pid -- only closed by
 * luck. These parse the platform-specific "who's listening on this port"
 * command output into the owning pid, so `loop:down` can also stop that one.
 * Never imports up.ts/down.ts.
 */
describe("parsePortOwnerFromNetstat", () => {
  test("parses the pid from a `netstat -ano | findstr :PORT | findstr LISTENING` line", () => {
    const output = "  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       6789\n";

    expect(parsePortOwnerFromNetstat(output)).toBe(6789);
  });

  test("returns null when there is no listening line", () => {
    expect(parsePortOwnerFromNetstat("")).toBeNull();
  });
});

describe("parsePortOwnerFromLsof", () => {
  test("parses the first pid from `lsof -ti:PORT` output", () => {
    expect(parsePortOwnerFromLsof("6789\n")).toBe(6789);
  });

  test("returns null for empty output", () => {
    expect(parsePortOwnerFromLsof("")).toBeNull();
  });

  test("returns null for non-numeric output", () => {
    expect(parsePortOwnerFromLsof("command not found\n")).toBeNull();
  });
});
