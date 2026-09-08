import { describe, expect, test } from "vitest";
import { formatSupabaseStartedLine, parseSupabaseStatusResult } from "./supabase-status";

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
 * appears in printed output). This seam builds the one-line summary
 * `loop/up.ts` prints on success from the parsed status object, structurally
 * -- it never reads any of that object's values -- so it can never leak one.
 */
describe("formatSupabaseStartedLine", () => {
  test("never includes any key name or key value from the parsed status, however key-shaped it looks", () => {
    const status = {
      API_URL: "http://127.0.0.1:45321",
      SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service-role-secret",
      SECRET_KEY: "sb_secret_abcdef1234567890",
      S3_PROTOCOL_ACCESS_KEY_SECRET: "s3-secret-abcdef1234567890",
    };

    const line = formatSupabaseStartedLine(status);

    expect(line).toBe("Supabase: started.");
    for (const [key, value] of Object.entries(status)) {
      expect(line).not.toContain(key);
      expect(line).not.toContain(value);
    }
  });
});
