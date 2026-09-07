/**
 * The pid-file the local loop (ticket #59) uses to track the detached
 * `next dev` process `npm run loop:up` starts, so `npm run loop:down` can
 * find and kill it later. Split into a pure parse/serialize pair (tested in
 * pidfile.test.ts) and thin fs wrappers around a real path (verified
 * empirically against a running loop, per the ticket brief).
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

/** Turns a pid into this file's on-disk contents: a bare decimal string, newline-terminated. */
export function serializePid(pid: number): string {
  return `${pid}\n`;
}

/** Parses this file's contents back into a pid, or null if the contents are empty/not a number. */
export function parsePidFileContents(contents: string): number | null {
  const trimmed = contents.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

/** Reads the pid at `path`, or null if the file doesn't exist or doesn't contain a valid pid. */
export function readPidFile(path: string): number | null {
  if (!existsSync(path)) return null;
  return parsePidFileContents(readFileSync(path, "utf8"));
}

/** Writes `pid` to `path`, overwriting whatever was there. */
export function writePidFile(path: string, pid: number): void {
  writeFileSync(path, serializePid(pid), "utf8");
}

/** Deletes the pid file at `path`, if it exists. A no-op otherwise. */
export function deletePidFile(path: string): void {
  if (existsSync(path)) unlinkSync(path);
}
