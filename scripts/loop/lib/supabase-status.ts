/**
 * Turns a captured `npx supabase status -o env` process result into
 * "running or not" plus the parsed env values -- the seam `loop/up.ts`
 * (ticket #59) uses to decide whether it needs to run `npx supabase start`.
 * Verified empirically that a stopped stack exits non-zero with nothing
 * useful on stdout (its error goes to stderr instead), so a non-zero (or
 * null, on a spawn failure) exit status is the only "not running" signal
 * this needs -- see docs/runbook-local-loop.md.
 */

export interface SupabaseStatusProcessResult {
  status: number | null;
  stdout: string;
}

export interface SupabaseStatus {
  running: boolean;
  env: Record<string, string>;
}

/** Parses `KEY="value"` (or `KEY=value`) lines, one per line, same shape as `supabase status -o env` prints. */
function parseEnvLines(output: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
    if (match) values[match[1]] = match[2];
  }
  return values;
}

export function parseSupabaseStatusResult(result: SupabaseStatusProcessResult): SupabaseStatus {
  if (result.status !== 0) {
    return { running: false, env: {} };
  }
  return { running: true, env: parseEnvLines(result.stdout) };
}
