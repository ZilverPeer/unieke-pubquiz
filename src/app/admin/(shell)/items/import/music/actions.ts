"use server";
/**
 * Music Item bulk import server action (spec 4, ticket #96, parent #80
 * stories 29/30/31). Same `ImportActionDeps` seam as the Picture import
 * (../pictures/actions.ts) -- assertOperator re-checked here, both
 * assertOperator and revalidateItems injectable so the integration suite
 * bypasses the real Supabase Auth session and the revalidatePath() call.
 *
 * Validation is complete before any write:
 *
 * 1. Both uploads are checked for presence/MIME/size before either is read
 *    into memory (the CSV against the same MIME set and 1 MiB limit as the
 *    other imports; the zip against a MIME set of its own and
 *    MUSIC_IMPORT_MAX_ZIP_BYTES).
 * 2. The CSV is parsed (parseMusicItemsCsv, src/admin/items/import-
 *    music-csv.ts) -- header, row limit, and every field except `file`
 *    (that module never sees the zip; see its own docblock).
 * 3. The zip is read (listZipEntries, src/admin/items/import-zip.ts,
 *    shared with the Picture import) into entries keyed by base name,
 *    skipping directory entries, `__MACOSX/` and `.DS_Store`.
 * 4. Every row's `file` column is matched to an entry (unmatched -> a
 *    `file`/fileMissing row error) and, once matched, re-validated through
 *    validateMusicItem with the entry's real `{ type, size }` (type from
 *    the extension, size from the entry's byte length, `fileRequired:
 *    true`) -- the same rules the single Music Item form enforces on its
 *    own file input, now checkable because the entry's bytes are known.
 * 5. Every entry not named by any row is a `file`/fileUnused error (`row:
 *    0`, `field: <entry name>`, no row to attach it to).
 *
 * Any error from steps 4-5 means the whole row report is returned and
 * nothing is cut or written. Only once every row passes are the clips cut:
 *
 * 6. Every matched entry is cut with cutClip (exported from
 *    src/repository/admin/music-items.ts, the same cut the single Music
 *    Item form uses) BEFORE any database write -- a song ffmpeg cannot
 *    read fails here as a `file`/fileNotAudio row error, with nothing
 *    written. This is the one place this ticket deviates from the ticket
 *    brief's "writes all rows, then cuts" wording, on purpose: cutting
 *    first needs no rollback for the commonest failure (a bad song), since
 *    nothing has been written to the database yet when a cut fails (see
 *    the PR body's "atomicity" section for the full reasoning).
 *
 * Only once every clip cuts cleanly does createMusicItems (music-items.ts)
 * run its own all-or-nothing batch write of rows and already-cut clips.
 */
import { revalidatePath } from "next/cache";
import { MUSIC_IMPORT_MAX_ZIP_BYTES } from "@/domain";
import { assertOperator } from "@/admin/auth/session";
import { type ActionResult, fail, succeed } from "@/admin/forms";
import { listZipEntries } from "@/admin/items/import-zip";
import { parseMusicItemsCsv, type RowError } from "@/admin/items/import-music-csv";
import { validateMusicItem, type MusicItemFormInput } from "@/admin/items/validate-music";
import { createSupabaseClient, resolveLocalStackConfig } from "@/repository";
import { loadSubsubcategoryOptions } from "@/repository/admin/items";
import { createMusicItems, cutClip, type CreateMusicItemsInput } from "@/repository/admin/music-items";
import type { ImportActionDeps } from "../actions";

function defaultRevalidateItems(): void {
  revalidatePath("/admin/items");
}

const defaultDeps: ImportActionDeps = { assertOperator, revalidateItems: defaultRevalidateItems };

const CSV_ALLOWED_FILE_TYPES = new Set(["text/csv", "application/vnd.ms-excel", "text/plain"]);
const CSV_MAX_FILE_BYTES = 1024 * 1024;
const ZIP_ALLOWED_FILE_TYPES = new Set(["application/zip", "application/x-zip-compressed", "application/octet-stream"]);

/**
 * File-level parser errors (bad header, too many rows, unreadable CSV --
 * `row: 0`, a fixed field name like "header" or "file") become the bare
 * field key itself, the same convention the other imports' own
 * *ErrorsToFieldErrors helpers use -- these are not tied to any row, so
 * the form renders them above the row report.
 */
function parserErrorsToFieldErrors(errors: RowError[]): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const error of errors) {
    const key = error.row === 0 ? error.field : `rows.${error.row}.${error.field}`;
    fieldErrors[key] = error.message;
  }
  return fieldErrors;
}

/**
 * Entry-matching and cut errors (steps 4-6 above) always use
 * `rows.<row>.<field>`, including `row: 0` for an unreferenced zip entry
 * (`field` is that entry's name, not a fixed field like "header") -- the
 * row report renders it as its own row (same convention as the Picture
 * import, ticket #95 decision, `rows.0.<name>`).
 */
function entryErrorsToFieldErrors(errors: RowError[]): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const error of errors) {
    fieldErrors[`rows.${error.row}.${error.field}`] = error.message;
  }
  return fieldErrors;
}

/** MIME type ALLOWED_MUSIC_MIME_TYPES (validate-music.ts) would recognise, derived from a zip entry's file name extension -- the zip carries no Content-Type of its own. */
function extensionMimeType(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  if (ext === "flac") return "audio/flac";
  if (ext === "ogg") return "audio/ogg";
  if (ext === "mp4" || ext === "m4a") return "audio/mp4";
  return "";
}

export async function importMusicItems(
  formData: FormData,
  deps: ImportActionDeps = defaultDeps,
): Promise<ActionResult<{ count: number }>> {
  await deps.assertOperator();

  const csvFile = formData.get("csv");
  if (!(csvFile instanceof File) || csvFile.size === 0) {
    return fail({ csv: "musicImport.errors.csvRequired" });
  }
  if (csvFile.type !== "" && !CSV_ALLOWED_FILE_TYPES.has(csvFile.type)) {
    return fail({ csv: "musicImport.errors.csvType" });
  }
  if (csvFile.size > CSV_MAX_FILE_BYTES) {
    return fail({ csv: "musicImport.errors.csvTooLarge" });
  }

  const zipFile = formData.get("zip");
  if (!(zipFile instanceof File) || zipFile.size === 0) {
    return fail({ zip: "musicImport.errors.zipRequired" });
  }
  if (zipFile.type !== "" && !ZIP_ALLOWED_FILE_TYPES.has(zipFile.type)) {
    return fail({ zip: "musicImport.errors.zipType" });
  }
  if (zipFile.size > MUSIC_IMPORT_MAX_ZIP_BYTES) {
    return fail({ zip: "musicImport.errors.zipTooLarge" });
  }

  const csvText = await csvFile.text();
  const zipBytes = new Uint8Array(await zipFile.arrayBuffer());

  const client = createSupabaseClient(resolveLocalStackConfig());
  const validIds = new Set((await loadSubsubcategoryOptions(client, "nl")).map((option) => option.id));

  const parsed = parseMusicItemsCsv(csvText, validIds);
  if (!parsed.ok) {
    return fail(parserErrorsToFieldErrors(parsed.errors));
  }

  const entryByName = listZipEntries(zipBytes);
  if (!entryByName) {
    return fail({ zip: "musicImport.errors.zipParseError" });
  }

  const errors: RowError[] = [];
  const usedEntryNames = new Set<string>();
  const matchedEntryByRow = new Map<number, Uint8Array>();

  parsed.rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const entry = entryByName.get(row.file);
    if (!entry) {
      errors.push({ row: rowNumber, field: "file", message: "musicImport.errors.fileMissing" });
      return;
    }
    usedEntryNames.add(row.file);

    const formInput: MusicItemFormInput = {
      subsubcategoryId: row.subsubcategoryId,
      difficulty: row.difficulty,
      artist: row.artist,
      title: row.title,
      nlChecked: Boolean(row.translations.nl),
      enChecked: Boolean(row.translations.en),
      startSeconds: String(row.startSeconds),
      endSeconds: String(row.endSeconds),
      file: { type: extensionMimeType(row.file), size: entry.byteLength },
    };
    const fieldErrors = validateMusicItem(formInput, validIds, { fileRequired: true });
    if (fieldErrors?.file) {
      errors.push({ row: rowNumber, field: "file", message: fieldErrors.file });
      return;
    }

    matchedEntryByRow.set(rowNumber, entry);
  });

  for (const name of entryByName.keys()) {
    if (!usedEntryNames.has(name)) {
      errors.push({ row: 0, field: name, message: "musicImport.errors.fileUnused" });
    }
  }

  if (errors.length > 0) {
    return fail(entryErrorsToFieldErrors(errors));
  }

  // Cut every clip before any database write -- see this file's own
  // docblock, "atomicity" in the PR body.
  const clipByRow = new Map<number, Uint8Array>();
  for (const [rowNumber, entry] of matchedEntryByRow) {
    const row = parsed.rows[rowNumber - 1];
    try {
      clipByRow.set(rowNumber, await cutClip(Buffer.from(entry), row.startSeconds, row.endSeconds));
    } catch {
      errors.push({ row: rowNumber, field: "file", message: "musicImport.errors.fileNotAudio" });
    }
  }

  if (errors.length > 0) {
    return fail(entryErrorsToFieldErrors(errors));
  }

  const inputs: CreateMusicItemsInput[] = parsed.rows.map((row, index) => ({
    subsubcategoryId: row.subsubcategoryId,
    difficulty: row.difficulty,
    artist: row.artist,
    title: row.title,
    translations: row.translations,
    clip: clipByRow.get(index + 1)!,
  }));

  const ids = await createMusicItems(client, inputs);
  deps.revalidateItems();
  return succeed({ count: ids.length });
}
