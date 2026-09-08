/**
 * Parses the platform-specific "who's listening on this port" command
 * output into the owning pid (fix round 1 on ticket #59): after
 * `loop:down` kills the app's tracked pid, a reviewer still found port
 * 3000 held by an untracked pid ("process not found" on a stale pid file,
 * the port only closed by luck) -- `down.ts` uses this to find and kill
 * that owner too.
 */

/** Parses `netstat -ano | findstr :PORT | findstr LISTENING` output (Windows): the last column of the first line is the pid. */
export function parsePortOwnerFromNetstat(output: string): number | null {
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const parts = trimmed.split(/\s+/);
    const last = parts[parts.length - 1];
    if (/^\d+$/.test(last)) return Number(last);
  }
  return null;
}

/** Parses `lsof -ti:PORT` output (POSIX): one pid per line, this takes the first. */
export function parsePortOwnerFromLsof(output: string): number | null {
  const trimmed = output.trim();
  if (trimmed === "") return null;
  const first = trimmed.split(/\r?\n/)[0].trim();
  return /^\d+$/.test(first) ? Number(first) : null;
}
