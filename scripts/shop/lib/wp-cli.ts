/**
 * Runs WP-CLI commands inside the wp-env `cli` container and returns clean
 * stdout, stripped of wp-env's own "Starting ..." / "Ran ..." framing lines.
 */
import { spawnSync } from "node:child_process";

export interface WpCliResult {
  stdout: string;
  stderr: string;
  status: number;
}

/** Runs `wp <args>` as the admin user inside the wp-env cli container. */
export function wpCli(args: string[], options: { user?: string } = {}): WpCliResult {
  const user = options.user ?? "admin";
  const fullArgs = ["wp-env", "run", "cli", "--", "wp", ...args, `--user=${user}`];
  // shell: true is required on Windows to resolve npx.cmd; every argument is
  // quoted so shell metacharacters in field values cannot be interpreted.
  const result = spawnSync("npx", fullArgs.map(quoteForShell), {
    encoding: "utf8",
    shell: true,
  });

  const stdout = cleanWpEnvOutput(result.stdout ?? "");
  const stderr = result.stderr ?? "";

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `wp ${args.join(" ")} failed (exit ${result.status}):\n${stdout}\n${stderr}`,
    );
  }

  return { stdout, stderr, status: result.status ?? 0 };
}

/** Like {@link wpCli} but parses the output as JSON (pass `--format=json`). */
export function wpCliJson<T>(args: string[], options: { user?: string } = {}): T {
  const { stdout } = wpCli(args, options);
  return JSON.parse(stdout) as T;
}

/** Wraps an argument in double quotes for a Windows/POSIX shell, escaping embedded quotes. */
function quoteForShell(arg: string): string {
  return `"${arg.replace(/"/g, '\\"')}"`;
}

/**
 * Strips wp-env's framing ("ℹ Starting '...'" at the start, "✔ Ran '...'" at
 * the end, sometimes glued onto the same line as WP-CLI's own last line of
 * output with no separating newline) from captured stdout, leaving only what
 * WP-CLI itself printed.
 */
function cleanWpEnvOutput(raw: string): string {
  return raw
    .replace(/^ℹ[^\n]*\n\n?/, "")
    .replace(/✔ Ran[\s\S]*$/, "")
    .trim();
}
