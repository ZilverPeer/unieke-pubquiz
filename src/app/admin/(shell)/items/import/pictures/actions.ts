"use server";
/**
 * Picture Item bulk import server action (spec 4, ticket #95, parent #80
 * stories 28/30/31). Same `ImportActionDeps` seam as the Text import
 * (../actions.ts) -- assertOperator re-checked here, both assertOperator
 * and revalidateItems injectable so the integration suite bypasses the real
 * Supabase Auth session and the revalidatePath() call.
 *
 * Validation is complete before any write:
 *
 * 1. Both uploads are checked for presence/MIME/size before either is read
 *    into memory (the CSV against the same MIME set and 1 MiB limit as the
 *    Text import; the zip against a MIME set of its own and
 *    PICTURE_IMPORT_MAX_ZIP_BYTES).
 * 2. The CSV is parsed (parsePictureItemsCsv, src/admin/items/import-
 *    picture-csv.ts) -- header, row limit, and every field except `file`
 *    (that module never sees the zip; see its own docblock).
 * 3. The zip is read (listZipEntries, src/admin/items/import-zip.ts,
 *    extracted in ticket #96 so the Music import can reuse the same
 *    entry-listing rules) into entries keyed by base name, skipping
 *    directory entries, `__MACOSX/` and `.DS_Store`.
 * 4. Every row's `file` column is matched to an entry (unmatched -> a
 *    `file`/fileMissing row error) and, once matched, re-validated through
 *    validatePictureItem with the entry's real `{ type, size }` (type from
 *    the extension, size from the entry's byte length, `fileRequired:
 *    true`) -- the same rules the single Picture Item form enforces on its
 *    own file input, now checkable because the entry's bytes are known.
 * 5. Every entry not named by any row is a `file`/fileUnused error (`row:
 *    0`, `field: <entry name>` -- there is no row to attach it to).
 * 6. Every entry a row did match is checked with assertImage
 *    (src/repository/admin/picture-items.ts) -- a throw becomes a
 *    fileNotImage row error.
 *
 * Any error from steps 4-6 means the whole row report (every error found,
 * not just the first) is returned and nothing is written. Only once every
 * row passes does createPictureItems (src/repository/admin/picture-
 * items.ts) run its own all-or-nothing batch write.
 */
import { revalidatePath } from "next/cache";
import { PICTURE_IMPORT_MAX_ZIP_BYTES } from "@/domain";
import { assertOperator } from "@/admin/auth/session";
import { type ActionResult, fail, succeed } from "@/admin/forms";
import { listZipEntries } from "@/admin/items/import-zip";
import { parsePictureItemsCsv, type RowError } from "@/admin/items/import-picture-csv";
import { validatePictureItem, type PictureItemFormInput } from "@/admin/items/validate-picture";
import { createSupabaseClient, resolveLocalStackConfig } from "@/repository";
import { loadSubsubcategoryOptions } from "@/repository/admin/items";
import { assertImage, createPictureItems, type CreatePictureItemsInput } from "@/repository/admin/picture-items";
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
 * field key itself, the same convention the Text import's own
 * rowErrorsToFieldErrors uses -- these are not tied to any row, so the form
 * renders them above the row report.
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
 * Entry-matching errors (steps 4-6 above) always use `rows.<row>.<field>`,
 * including `row: 0` for an unreferenced zip entry (`field` is that entry's
 * name, not a fixed field like "header") -- the row report renders it as
 * its own row (ticket #95 decision, `rows.0.<name>`), distinct from the
 * file-level parser errors above.
 */
function entryErrorsToFieldErrors(errors: RowError[]): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const error of errors) {
    fieldErrors[`rows.${error.row}.${error.field}`] = error.message;
  }
  return fieldErrors;
}

/** MIME type PICTURE_ALLOWED_MIME_TYPES would recognise, derived from a zip entry's file name extension -- the zip carries no Content-Type of its own. */
function extensionMimeType(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "";
}

export async function importPictureItems(
  formData: FormData,
  deps: ImportActionDeps = defaultDeps,
): Promise<ActionResult<{ count: number }>> {
  await deps.assertOperator();

  const csvFile = formData.get("csv");
  if (!(csvFile instanceof File) || csvFile.size === 0) {
    return fail({ csv: "pictureImport.errors.csvRequired" });
  }
  if (csvFile.type !== "" && !CSV_ALLOWED_FILE_TYPES.has(csvFile.type)) {
    return fail({ csv: "pictureImport.errors.csvType" });
  }
  if (csvFile.size > CSV_MAX_FILE_BYTES) {
    return fail({ csv: "pictureImport.errors.csvTooLarge" });
  }

  const zipFile = formData.get("zip");
  if (!(zipFile instanceof File) || zipFile.size === 0) {
    return fail({ zip: "pictureImport.errors.zipRequired" });
  }
  if (zipFile.type !== "" && !ZIP_ALLOWED_FILE_TYPES.has(zipFile.type)) {
    return fail({ zip: "pictureImport.errors.zipType" });
  }
  if (zipFile.size > PICTURE_IMPORT_MAX_ZIP_BYTES) {
    return fail({ zip: "pictureImport.errors.zipTooLarge" });
  }

  const csvText = await csvFile.text();
  const zipBytes = new Uint8Array(await zipFile.arrayBuffer());

  const client = createSupabaseClient(resolveLocalStackConfig());
  const validIds = new Set((await loadSubsubcategoryOptions(client, "nl")).map((option) => option.id));

  const parsed = parsePictureItemsCsv(csvText, validIds);
  if (!parsed.ok) {
    return fail(parserErrorsToFieldErrors(parsed.errors));
  }

  const entryByName = listZipEntries(zipBytes);
  if (!entryByName) {
    return fail({ zip: "pictureImport.errors.zipParseError" });
  }

  const errors: RowError[] = [];
  const usedEntryNames = new Set<string>();
  const matchedEntryByRow = new Map<number, Uint8Array>();

  parsed.rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const entry = entryByName.get(row.file);
    if (!entry) {
      errors.push({ row: rowNumber, field: "file", message: "pictureImport.errors.fileMissing" });
      return;
    }
    usedEntryNames.add(row.file);

    const formInput: PictureItemFormInput = {
      subsubcategoryId: row.subsubcategoryId,
      difficulty: row.difficulty,
      nl: { answer: row.translations.nl?.answer ?? "", fact: row.translations.nl?.fact ?? "" },
      en: { answer: row.translations.en?.answer ?? "", fact: row.translations.en?.fact ?? "" },
      file: { type: extensionMimeType(row.file), size: entry.byteLength },
      fileRequired: true,
    };
    const fieldErrors = validatePictureItem(formInput, validIds);
    if (fieldErrors?.file) {
      errors.push({ row: rowNumber, field: "file", message: fieldErrors.file });
      return;
    }

    matchedEntryByRow.set(rowNumber, entry);
  });

  for (const name of entryByName.keys()) {
    if (!usedEntryNames.has(name)) {
      errors.push({ row: 0, field: name, message: "pictureImport.errors.fileUnused" });
    }
  }

  for (const [rowNumber, entry] of matchedEntryByRow) {
    try {
      await assertImage(Buffer.from(entry));
    } catch {
      errors.push({ row: rowNumber, field: "file", message: "pictureImport.errors.fileNotImage" });
    }
  }

  if (errors.length > 0) {
    return fail(entryErrorsToFieldErrors(errors));
  }

  const inputs: CreatePictureItemsInput[] = parsed.rows.map((row, index) => ({
    subsubcategoryId: row.subsubcategoryId,
    difficulty: row.difficulty,
    translations: row.translations,
    image: Buffer.from(matchedEntryByRow.get(index + 1)!),
  }));

  const ids = await createPictureItems(client, inputs);
  deps.revalidateItems();
  return succeed({ count: ids.length });
}
