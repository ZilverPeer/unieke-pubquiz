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
  test("parses the pid from a `netstat -ano | findstr LISTENING` line for the wanted port", () => {
    const output = "  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       6789\n";

    expect(parsePortOwnerFromNetstat(output, 3000)).toBe(6789);
  });

  test("returns null when there is no listening line", () => {
    expect(parsePortOwnerFromNetstat("", 3000)).toBeNull();
  });

  // Fix round 2: findstr `:3000` is a substring match, so a line for port
  // 30000 (or 3000x) also passed the old grep-in-a-string parser and could
  // be returned as the port-3000 owner -- a real reviewer scenario where
  // `taskkill /T` would then kill an unrelated tree while the real port
  // 3000 listener went unnoticed. This exercises the fix: the local-address
  // column's port (after the last `:`) must equal the wanted port exactly.
  test("a same-prefix port (30000) before the real port-3000 line is not mistaken for it", () => {
    const output =
      "  TCP    0.0.0.0:30000          0.0.0.0:0              LISTENING       1111\n" +
      "  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       6789\n";

    expect(parsePortOwnerFromNetstat(output, 3000)).toBe(6789);
  });

  test("only a same-prefix port (30000) present, with no exact match, returns null", () => {
    const output = "  TCP    0.0.0.0:30000          0.0.0.0:0              LISTENING       1111\n";

    expect(parsePortOwnerFromNetstat(output, 3000)).toBeNull();
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
