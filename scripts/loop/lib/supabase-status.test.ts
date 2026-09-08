import { describe, expect, test } from "vitest";
import { formatSupabaseStartedLine, formatSupabaseStartFailure, parseSupabaseStatusResult } from "./supabase-status";

/**
 * Unit seam for ticket #59's `loop:up`: turning a captured `npx supabase
 * status -o env` process result (status code + stdout) into "running or
 * not" plus the parsed env values -- verified empirically that a stopped
 * stack exits non-zero with nothing useful on stdout (see
 * docs/runbook-local-loop.md / shop/README.md context), so `status !== 0`
 * is the only "not running" signal this needs. Never imports up.ts/down.ts.
 */
describe("parseSupabaseStatusResult", () => {
  test("a non-zero exit status means the stack is not running, regardless of stdout", () => {
    const result = parseSupabaseStatusResult({ status: 1, stdout: "" });

    expect(result).toEqual({ running: false, env: {} });
  });

  test("a zero exit status means the stack is running, and parses KEY=value lines from stdout", () => {
    const stdout = 'API_URL="http://127.0.0.1:45321"\nSERVICE_ROLE_KEY="abc123"\n';
    const result = parseSupabaseStatusResult({ status: 0, stdout });

    expect(result).toEqual({
      running: true,
      env: { API_URL: "http://127.0.0.1:45321", SERVICE_ROLE_KEY: "abc123" },
    });
  });

  test("a null exit status (spawn failure) means the stack is not running", () => {
    const result = parseSupabaseStatusResult({ status: null, stdout: "" });

    expect(result).toEqual({ running: false, env: {} });
  });
});

/**
 * Ticket #66: `npx supabase start`'s stdout is one JSON line carrying the
 * local stack's keys (publishable, secret, service role, S3 access key --
 * the well-known local demo keys, but the repo rule is that no key ever
 * appears in printed output). `formatSupabaseStartedLine` takes no
 * argument at all -- `up.ts` never parses or reads that stdout -- so there
 * is no path for one of those keys to reach the "started" line, ever.
 */
describe("formatSupabaseStartedLine", () => {
  test("is always the fixed line, with no way to pass it anything", () => {
    expect(formatSupabaseStartedLine()).toBe("Supabase: started.");
  });
});

/**
 * Ticket #66 fix round: the failure message `up.ts` prints when `npx
 * supabase start` exits non-zero. Built only from the exit code and the
 * last few lines of *stderr* -- never given stdout, so it structurally
 * cannot leak the JSON with the keys, which is on stdout. stderr itself is
 * printed unchanged (that's the whole point -- it's the diagnostics Erik
 * needs), including anything key-shaped that happens to land there, since
 * only stdout is off limits here, not stderr.
 */
describe("formatSupabaseStartFailure", () => {
  test("includes the exit code and the stderr lines given to it, unchanged", () => {
    const message = formatSupabaseStartFailure(1, ["Error: some real failure reason"]);

    expect(message).toContain("1");
    expect(message).toContain("Error: some real failure reason");
    expect(message).toContain('Run "npx supabase start" by hand.');
  });

  test("a null exit code (spawn failure) is reported as null, not thrown on", () => {
    const message = formatSupabaseStartFailure(null, []);

    expect(message).toContain("null");
  });

  test("passes key-shaped stderr lines through unchanged -- only stdout is off limits, not stderr", () => {
    const stderrTail = ["SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service-role-secret"];

    const message = formatSupabaseStartFailure(1, stderrTail);

    expect(message).toContain(stderrTail[0]);
  });
});
