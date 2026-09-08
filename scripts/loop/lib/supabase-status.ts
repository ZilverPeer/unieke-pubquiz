/**
 * Turns a captured `npx supabase status -o env` process result into
 * "running or not" plus the parsed env values -- the seam `loop/up.ts`
 * (ticket #59) uses to decide whether it needs to run `npx supabase start`.
 * Verified empirically that a stopped stack exits non-zero with nothing
 * useful on stdout (its error goes to stderr instead), so a non-zero (or
 * null, on a spawn failure) exit status is the only "not running" signal
 * this needs -- see docs/runbook-local-loop.md.
 *
 * The `KEY="value"` line parser itself is not duplicated here -- it's
 * `parseStatusEnv`, exported from src/repository/local-stack-config.ts
 * (the original owner of this exact parsing need), reused as-is.
 */
import { parseStatusEnv } from "../../../src/repository";

export interface SupabaseStatusProcessResult {
  status: number | null;
  stdout: string;
}

export interface SupabaseStatus {
  running: boolean;
  env: Record<string, string>;
}

export function parseSupabaseStatusResult(result: SupabaseStatusProcessResult): SupabaseStatus {
  if (result.status !== 0) {
    return { running: false, env: {} };
  }
  return { running: true, env: parseStatusEnv(result.stdout) };
}

/**
 * Ticket #66: the one line `loop/up.ts` prints after `npx supabase start`
 * succeeds. `npx supabase start`'s stdout is one JSON line carrying the
 * local stack's keys (publishable, secret, service role, S3 access key --
 * the well-known local demo keys, but the repo rule is that no key ever
 * appears in printed output). This function takes the parsed status object
 * but deliberately never reads any of its values, so the "started" line it
 * builds can never leak one, however key-shaped the object's contents are.
 */
export function formatSupabaseStartedLine(status: Record<string, unknown>): string {
  void status; // deliberately unread -- see the docblock above.
  return "Supabase: started.";
}
