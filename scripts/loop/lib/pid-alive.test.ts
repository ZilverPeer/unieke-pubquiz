import { describe, expect, test } from "vitest";
import { isPidAlive, isPidAliveFromTasklistOutput } from "./pid-alive";

/**
 * Unit seam for fix round 1 on ticket #59: before `loop:up` spawns a second
 * `next dev`, it needs to know whether the pid named by `.local/next-dev.pid`
 * is still alive. Windows has no `process.kill(pid, 0)` liveness probe, so
 * this parses `tasklist /FI "PID eq <pid>"` output instead; POSIX uses an
 * injected probe standing in for `process.kill(pid, 0)`. Never imports
 * up.ts/down.ts (they run their whole flow on import).
 */
describe("isPidAliveFromTasklistOutput", () => {
  test("a matching tasklist row means the pid is alive", () => {
    const output =
      'Image Name                    PID Session Name        Session#    Mem Usage\n' +
      '========================= ======== ================ =========== ============\n' +
      'node.exe                     12345 Console                    1     45,000 K\n';

    expect(isPidAliveFromTasklistOutput(output, 12345)).toBe(true);
  });

  test('the "no tasks" message means the pid is not alive', () => {
    const output = "INFO: No tasks are running which match the specified criteria.\n";

    expect(isPidAliveFromTasklistOutput(output, 12345)).toBe(false);
  });
});

describe("isPidAlive", () => {
  test("on win32, alive is decided by the injected tasklist output", () => {
    const alive = isPidAlive(12345, {
      platform: "win32",
      tasklist: () => "node.exe                     12345 Console                    1     45,000 K\n",
      posixProbe: () => {
        throw new Error("must not be called on win32");
      },
    });

    expect(alive).toBe(true);
  });

  test("on a non-win32 platform, alive is decided by the injected posix probe", () => {
    const alive = isPidAlive(12345, {
      platform: "linux",
      tasklist: () => {
        throw new Error("must not be called on non-win32");
      },
      posixProbe: () => true,
    });

    expect(alive).toBe(true);
  });

  test("a throwing posix probe (ESRCH) means the pid is not alive", () => {
    const alive = isPidAlive(12345, {
      platform: "linux",
      tasklist: () => "",
      posixProbe: () => {
        throw new Error("ESRCH");
      },
    });

    expect(alive).toBe(false);
  });
});
