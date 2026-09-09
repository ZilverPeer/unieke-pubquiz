/**
 * Resolves the local Supabase stack's URL and service role key:
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from the environment if set,
 * otherwise parsed from `supabase status -o env`.
 *
 * Local-dev only -- this is how the repository integration tests and the
 * `src/scripts/generate.ts` dev script find the local stack. Never use this
 * against a hosted project.
 */
import { execSync } from "node:child_process";
import type { RepositoryConfig } from "./client";

// Supabase CLI's well-known local demo service role key. Only ever valid
// against a local stack (see supabase/config.toml's demo project setup) --
// local-only fallback, never a real secret.
const DEMO_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

/**
 * Parses `KEY="value"` (or `KEY=value`) lines, one per line -- the shape
 * `supabase status -o env` prints. Exported so scripts/loop/lib/supabase-status.ts
 * (ticket #59) can reuse the exact same parser instead of a second copy.
 */
export function parseStatusEnv(output: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
    if (match) values[match[1]] = match[2];
  }
  return values;
}

// The CLI fallback's parsed result, cached in module scope for the life of
// the process (ticket #123: `npx supabase status -o env` takes 4-5 s, and
// every admin request/server action/worker job used to pay that cost). The
// environment branch is never cached -- reading process.env is free, and
// caching it would freeze a value that could legitimately change between
// calls (e.g. a test harness re-setting it).
let cachedCliConfig: RepositoryConfig | null = null;

interface LocalStackConfigDeps {
  env: Record<string, string | undefined>;
  exec: (command: string) => string;
}

/**
 * The testable core of resolveLocalStackConfig, taking env/exec as
 * parameters instead of reading process.env/execSync directly. Exported only
 * for local-stack-config.test.ts to inject a stub -- resolveLocalStackConfig
 * is still the one public seam every other caller uses.
 */
export function resolveLocalStackConfigWith(deps: LocalStackConfigDeps): RepositoryConfig {
  if (deps.env.SUPABASE_URL && deps.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      url: deps.env.SUPABASE_URL,
      serviceRoleKey: deps.env.SUPABASE_SERVICE_ROLE_KEY,
    };
  }

  if (cachedCliConfig) {
    return cachedCliConfig;
  }

  const output = deps.exec("npx supabase status -o env");
  const values = parseStatusEnv(output);

  cachedCliConfig = {
    url: values.API_URL ?? "http://127.0.0.1:45321",
    serviceRoleKey: values.SERVICE_ROLE_KEY ?? DEMO_SERVICE_ROLE_KEY,
  };
  return cachedCliConfig;
}

export function resolveLocalStackConfig(): RepositoryConfig {
  return resolveLocalStackConfigWith({
    env: process.env,
    exec: (command) =>
      // A single command string (not execFileSync + shell:true) so Node can
      // resolve `npx` (a .cmd shim) on Windows without the shell-injection
      // DeprecationWarning; the command is a fixed literal, never built from
      // user input, so there is no injection concern here.
      execSync(command, {
        encoding: "utf-8",
        // The Supabase CLI logs container housekeeping (e.g. "Stopped
        // services: [...]") to stderr on every invocation; only stdout
        // carries the env output this function parses.
        stdio: ["ignore", "pipe", "ignore"],
      }),
  });
}

/**
 * Test-only: clears the module-scope CLI-fallback cache between test cases.
 * Not used outside local-stack-config.test.ts.
 */
export function __resetLocalStackConfigCache(): void {
  cachedCliConfig = null;
}
