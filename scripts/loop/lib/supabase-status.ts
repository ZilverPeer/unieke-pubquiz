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
