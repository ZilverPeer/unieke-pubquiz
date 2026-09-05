/**
 * Resolves the local Supabase stack's URL and service role key for the
 * repository integration tests: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from
 * the environment if set, otherwise parsed from `supabase status -o env`.
 * Not imported by src/repository/index.ts -- test-only.
 */
import { execFileSync } from "node:child_process";
import type { RepositoryConfig } from "../client";

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

  // `shell: true` is required for Node to resolve `npx` (a .cmd shim) on
  // Windows; the args here are fixed literals, never user input, so the
  // escaping caveat Node warns about does not apply.
  const output = execFileSync("npx", ["supabase", "status", "-o", "env"], {
    encoding: "utf-8",
    shell: true,
  });
  const values = parseStatusEnv(output);

  return {
    url: values.API_URL ?? "http://127.0.0.1:45321",
    serviceRoleKey: values.SERVICE_ROLE_KEY ?? DEMO_SERVICE_ROLE_KEY,
  };
}
