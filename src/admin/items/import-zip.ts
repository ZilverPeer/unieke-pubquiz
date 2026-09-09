/**
 * Pure zip-entry listing shared by every bulk import that pairs a CSV with
 * a zip of files (spec 4, ticket #95 Picture, ticket #96 Music) --
 * extracted from the Picture import's own actions.ts (ticket #96 decision
 * "Zip") so neither action's entry-skipping rules are copied. No database
 * access, no file-type inspection: this module only knows zip structure.
 */
import { unzipSync } from "fflate";

/** The final path segment -- the file name a CSV row's `file` column names, ignoring any folder the zip entry sits in. */
export function entryBaseName(path: string): string {
  const segments = path.split("/");
  return segments[segments.length - 1];
}

/** Directory entries, `__MACOSX/` metadata and `.DS_Store` files never name a real uploaded file. */
export function isSkippedEntry(path: string): boolean {
  if (path.endsWith("/")) return true;
  if (path === "__MACOSX" || path.startsWith("__MACOSX/") || path.includes("/__MACOSX/")) return true;
  if (entryBaseName(path) === ".DS_Store") return true;
  return false;
}

/**
 * Reads `zipBytes` and returns every real entry keyed by its exact,
 * case-sensitive base name (directories, `__MACOSX/` entries and
 * `.DS_Store` files skipped); `null` when the bytes are not a readable zip
 * at all (unzipSync throws).
 */
export function listZipEntries(zipBytes: Uint8Array): Map<string, Uint8Array> | null {
  let rawEntries: Record<string, Uint8Array>;
  try {
    rawEntries = unzipSync(zipBytes);
  } catch {
    return null;
  }

  const entryByName = new Map<string, Uint8Array>();
  for (const [path, data] of Object.entries(rawEntries)) {
    if (isSkippedEntry(path)) continue;
    entryByName.set(entryBaseName(path), data);
  }
  return entryByName;
}
