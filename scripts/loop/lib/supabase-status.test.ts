import { describe, expect, test } from "vitest";
import { parseSupabaseStatusResult } from "./supabase-status";

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
