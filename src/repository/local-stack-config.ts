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

function parseStatusEnv(output: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
    if (match) values[match[1]] = match[2];
  }
  return values;
}

export function resolveLocalStackConfig(): RepositoryConfig {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      url: process.env.SUPABASE_URL,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
  }

  // A single command string (not execFileSync + shell:true) so Node can
  // resolve `npx` (a .cmd shim) on Windows without the shell-injection
  // DeprecationWarning; the command is a fixed literal, never built from
  // user input, so there is no injection concern here.
  const output = execSync("npx supabase status -o env", {
    encoding: "utf-8",
    // The Supabase CLI logs container housekeeping (e.g. "Stopped
    // services: [...]") to stderr on every invocation; only stdout carries
    // the env output this function parses.
    stdio: ["ignore", "pipe", "ignore"],
  });
  const values = parseStatusEnv(output);

  return {
    url: values.API_URL ?? "http://127.0.0.1:45321",
    serviceRoleKey: values.SERVICE_ROLE_KEY ?? DEMO_SERVICE_ROLE_KEY,
  };
}
