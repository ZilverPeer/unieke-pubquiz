/**
 * Whether a pid names a live process (fix round 1 on ticket #59): `up.ts`
 * needs this before spawning `next dev`, so a stale `.local/next-dev.pid`
 * pointing at a dead pid doesn't stop it from starting a fresh one, and a
 * live one doesn't get a second app spawned alongside it. Windows has no
 * signal-0 probe, so that platform parses `tasklist /FI "PID eq <pid>"`
 * output instead; POSIX uses `process.kill(pid, 0)`, which throws (ESRCH)
 * when the pid is gone. `tasklist`/`posixProbe` are injected so the unit
 * tests never spawn a real process or depend on the host platform.
 */

/** Parses `tasklist /FI "PID eq <pid>"` output: a matching row means alive, the "No tasks" message means gone. */
export function isPidAliveFromTasklistOutput(output: string, pid: number): boolean {
  if (/No tasks are running/i.test(output)) return false;
  return new RegExp(`(^|\\s)${pid}(\\s|$)`, "m").test(output);
}

export interface PidAliveDeps {
  platform: NodeJS.Platform;
  /** Returns the captured stdout of `tasklist /FI "PID eq <pid>"`. Only called on win32. */
  tasklist: (pid: number) => string;
  /** Stands in for `process.kill(pid, 0)`: returns true if alive, throws (like ESRCH) if not. Only called off win32. */
  posixProbe: (pid: number) => boolean;
}

/** True if `pid` names a currently-running process, per the platform-appropriate probe in `deps`. */
export function isPidAlive(pid: number, deps: PidAliveDeps): boolean {
  if (deps.platform === "win32") {
    return isPidAliveFromTasklistOutput(deps.tasklist(pid), pid);
  }
  try {
    return deps.posixProbe(pid);
  } catch {
    return false;
  }
}
