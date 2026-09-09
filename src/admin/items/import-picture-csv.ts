/**
 * Pure CSV parsing for the Picture Item bulk import (spec 4, ticket #95).
 * No database access, no zip/file-content inspection -- the same seam as
 * import-csv.ts's parseTextItemsCsv, extended for Picture Items' extra
 * `file` column (matched against a zip entry by the server action, once the
 * zip has been read) rather than the question/answer/fact-only shape Text
 * Items have.
 *
 * Row validation reuses validatePictureItem (./validate-picture.ts, ticket
 * #90's own rules for the single Picture Item form) for every field except
 * `file`: this module never sees the zip, so it cannot derive a real MIME
 * type or byte size, and calls validatePictureItem with `file: null,
 * fileRequired: false` (never producing a `file` error of its own). The
 * `file` column itself is checked here only for presence -- an empty
 * column can never match a zip entry, so it fails immediately with the same
 * message key the server action's own "every row names an entry" check
 * uses (decision "Validation is complete before any write" in ticket #95's
 * story), rather than a separate message an operator would read as a
 * different problem.
 *
 * The action (src/app/admin/(shell)/items/import/pictures/actions.ts) is
 * the one place that knows the zip's entries; it re-validates each row's
 * `file` metadata (MIME derived from the extension, size from the matched
 * entry's byte length) through validatePictureItem a second time once a
 * match is found, and separately checks the file is a real image
 * (assertImage, src/repository/admin/picture-items.ts) and that every zip
 * entry is named by some row.
 */
import { parse } from "csv-parse/sync";
import type { Difficulty } from "@/domain";
import { PICTURE_ITEM_IMPORT_MAX_ROWS } from "@/domain";
import type { PictureItemTranslations } from "@/repository/admin/picture-items";
import { PARSE_OPTIONS } from "./import-csv";
import { validatePictureItem, type PictureItemFormInput } from "./validate-picture";

/** Exact header the picture template route and this parser both use, in this order. */
export const PICTURE_ITEM_IMPORT_HEADER = [
  "file",
  "subsubcategoryId",
  "difficulty",
  "answer_nl",
  "fact_nl",
  "answer_en",
  "fact_en",
] as const;

/**
 * validatePictureItem's field keys (`nl.answer`, `file`, ...) mapped to the
 * header column they came from, the same reasoning as import-csv.ts's own
 * csvColumnForField (fix round 1, PR #118): `translations` (the "at least
 * one Locale required" error, not tied to one column) and any other
 * unmapped key have no CSV column and return `null`.
 */
const FIELD_TO_HEADER_COLUMN: Partial<Record<string, (typeof PICTURE_ITEM_IMPORT_HEADER)[number]>> = {
  file: "file",
  subsubcategoryId: "subsubcategoryId",
  difficulty: "difficulty",
  "nl.answer": "answer_nl",
  "nl.fact": "fact_nl",
  "en.answer": "answer_en",
  "en.fact": "fact_en",
};

export function pictureCsvColumnForField(field: string): string | null {
  return FIELD_TO_HEADER_COLUMN[field] ?? null;
}

export interface RowError {
  /** 1-based data row (header excluded); 0 for a file-level error. */
  row: number;
  field: string;
  /** A message key, resolved with next-intl in the page. */
  message: string;
}

export interface PictureCsvRow {
  /** The zip entry's base name this row names -- matched by the action. */
  file: string;
  subsubcategoryId: string;
  difficulty: Difficulty;
  translations: PictureItemTranslations;
}

export type ParsePictureItemsCsvResult = { ok: true; rows: PictureCsvRow[] } | { ok: false; errors: RowError[] };

type PictureCsvRecord = Record<(typeof PICTURE_ITEM_IMPORT_HEADER)[number], string>;

function fileError(message: string): ParsePictureItemsCsvResult {
  return { ok: false, errors: [{ row: 0, field: "file", message }] };
}

function headerError(): ParsePictureItemsCsvResult {
  return { ok: false, errors: [{ row: 0, field: "header", message: "pictureImport.errors.header" }] };
}

function buildTranslations(input: PictureItemFormInput): PictureItemTranslations {
  const translations: PictureItemTranslations = {};
  for (const locale of ["nl", "en"] as const) {
    const { answer, fact } = input[locale];
    if (answer.trim()) {
      translations[locale] = { answer, fact: fact.trim() ? fact : undefined };
    }
  }
  return translations;
}

export function parsePictureItemsCsv(
  text: string,
  knownSubsubcategoryIds: ReadonlySet<string>,
): ParsePictureItemsCsvResult {
  let headerRow: string[];
  try {
    const headerPeek = parse(text, { ...PARSE_OPTIONS, to: 1 }) as string[][];
    headerRow = headerPeek[0] ?? [];
  } catch {
    return fileError("pictureImport.errors.parseError");
  }

  if (headerRow.length === 0) {
    return fileError("pictureImport.errors.empty");
  }

  const headerMatches =
    headerRow.length === PICTURE_ITEM_IMPORT_HEADER.length &&
    headerRow.every((cell, index) => cell === PICTURE_ITEM_IMPORT_HEADER[index]);
  if (!headerMatches) {
    return headerError();
  }

  let records: PictureCsvRecord[];
  try {
    records = parse(text, { ...PARSE_OPTIONS, columns: true }) as PictureCsvRecord[];
  } catch {
    return fileError("pictureImport.errors.parseError");
  }

  if (records.length === 0) {
    return fileError("pictureImport.errors.empty");
  }

  if (records.length > PICTURE_ITEM_IMPORT_MAX_ROWS) {
    return fileError("pictureImport.errors.tooManyRows");
  }

  const errors: RowError[] = [];
  const rows: PictureCsvRow[] = [];

  records.forEach((record, index) => {
    const rowNumber = index + 1;

    if (record.file.trim() === "") {
      errors.push({ row: rowNumber, field: "file", message: "pictureImport.errors.fileMissing" });
      return;
    }

    const formInput: PictureItemFormInput = {
      subsubcategoryId: record.subsubcategoryId,
      difficulty: record.difficulty,
      nl: { answer: record.answer_nl, fact: record.fact_nl },
      en: { answer: record.answer_en, fact: record.fact_en },
      file: null,
      fileRequired: false,
    };

    const fieldErrors = validatePictureItem(formInput, knownSubsubcategoryIds);
    if (fieldErrors) {
      for (const [field, message] of Object.entries(fieldErrors)) {
        errors.push({ row: rowNumber, field, message });
      }
      return;
    }

    rows.push({
      file: record.file.trim(),
      subsubcategoryId: formInput.subsubcategoryId,
      difficulty: formInput.difficulty as Difficulty,
      translations: buildTranslations(formInput),
    });
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, rows };
}
