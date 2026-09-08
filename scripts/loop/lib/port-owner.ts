/**
 * Parses the platform-specific "who's listening on this port" command
 * output into the owning pid (fix round 1 on ticket #59): after
 * `loop:down` kills the app's tracked pid, a reviewer still found port
 * 3000 held by an untracked pid ("process not found" on a stale pid file,
 * the port only closed by luck) -- `down.ts` uses this to find and kill
 * that owner too.
 */

/**
 * Parses `netstat -ano | findstr LISTENING` output (Windows) for the pid
 * listening on exactly `port`.
 *
 * Fix round 2: the caller used to also pipe through `findstr :PORT`, a
 * substring match -- a listener on port 30000 (or 3000x) passes that filter
 * for port 3000 too, so the old "take the last column of the first line"
 * parser could return an unrelated pid (and `taskkill /T` would kill its
 * tree) while the real port-3000 listener was never even considered. This
 * instead reads each row's local-address column (second column, e.g.
 * `0.0.0.0:3000`), takes the port after its *last* `:` (IPv6 addresses
 * contain colons themselves), and requires an exact numeric match plus a
 * LISTENING state; the last column of that row is the pid.
 */
export function parsePortOwnerFromNetstat(output: string, port: number): number | null {
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 4) continue;
    const [, localAddress, , state] = parts;
    if (state !== "LISTENING") continue;
    const lastColon = localAddress.lastIndexOf(":");
    if (lastColon === -1) continue;
    const localPort = localAddress.slice(lastColon + 1);
    if (Number(localPort) !== port) continue;
    const pid = parts[parts.length - 1];
    if (/^\d+$/.test(pid)) return Number(pid);
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
