/**
 * Pure CSV parsing for the Music Item bulk import (spec 4, ticket #96). No
 * database access, no zip/file-content inspection -- the same seam as
 * import-picture-csv.ts's parsePictureItemsCsv, extended for Music Items'
 * `artist`/`title`/`startSeconds`/`endSeconds`/`locales` columns instead of
 * the answer/fact-per-Locale shape Picture Items have.
 *
 * Row validation reuses validateMusicItem (./validate-music.ts, ticket
 * #91's own rules for the single Music Item form) for every field except
 * `file`: this module never sees the zip, so it cannot derive a real MIME
 * type or byte size. Unlike the Picture parser (which passes `file: null,
 * fileRequired: false` and so never checks the cut range either, since
 * Picture Items have none), the Music cut range has to be checked from the
 * CSV alone -- validateMusicItem only runs its range check when
 * `fileRequired || file !== null` (its own "rangeRequired" rule), so this
 * module passes a placeholder-but-valid `file` (`{ type: "audio/mpeg",
 * size: 0 }`) to make that condition true without ever producing a `file`
 * field error of its own; the action re-validates a second time once a
 * zip entry is matched, this time with the entry's real `{ type, size }`
 * (its own docblock).
 *
 * `locales` (`nl`, `en` or `nl;en`) is parsed here, not delegated to
 * validateMusicItem (which only takes booleans): an unrecognised value is
 * its own row error (`locales`/"musicImport.errors.locales"), not folded
 * into validateMusicItem's "at least one Locale required" case.
 *
 * The `file` column itself is checked here only for presence -- an empty
 * column can never match a zip entry, so it fails immediately with the
 * same message key the server action's own "every row names an entry"
 * check uses (decision "Validation is complete before any write" in
 * ticket #96's brief), rather than a separate message an operator would
 * read as a different problem.
 */
import { parse } from "csv-parse/sync";
import type { Difficulty } from "@/domain";
import { MUSIC_ITEM_IMPORT_MAX_ROWS } from "@/domain";
import type { MusicItemTranslations } from "@/repository/admin/music-items";
import { PARSE_OPTIONS } from "./import-csv";
import { validateMusicItem, type MusicItemFormInput } from "./validate-music";

/** Exact header the music template route and this parser both use, in this order. */
export const MUSIC_ITEM_IMPORT_HEADER = [
  "file",
  "subsubcategoryId",
  "difficulty",
  "artist",
  "title",
  "startSeconds",
  "endSeconds",
  "locales",
] as const;

/**
 * validateMusicItem's field keys mapped to the header column they came
 * from, the same reasoning as import-picture-csv.ts's own
 * pictureCsvColumnForField: `translations` (the "at least one Locale
 * required" error) has no column of its own, but is the same operator
 * mistake as a bad `locales` cell, so both map to that column; any other
 * unmapped key returns `null`.
 */
const FIELD_TO_HEADER_COLUMN: Partial<Record<string, (typeof MUSIC_ITEM_IMPORT_HEADER)[number]>> = {
  file: "file",
  subsubcategoryId: "subsubcategoryId",
  difficulty: "difficulty",
  artist: "artist",
  title: "title",
  endSeconds: "endSeconds",
  translations: "locales",
  locales: "locales",
};

export function musicCsvColumnForField(field: string): string | null {
  return FIELD_TO_HEADER_COLUMN[field] ?? null;
}

export interface RowError {
  /** 1-based data row (header excluded); 0 for a file-level error. */
  row: number;
  field: string;
  /** A message key, resolved with next-intl in the page. */
  message: string;
}

export interface MusicCsvRow {
  /** The zip entry's base name this row names -- matched by the action. */
  file: string;
  subsubcategoryId: string;
  difficulty: Difficulty;
  artist: string;
  title: string;
  startSeconds: number;
  endSeconds: number;
  translations: MusicItemTranslations;
}

export type ParseMusicItemsCsvResult = { ok: true; rows: MusicCsvRow[] } | { ok: false; errors: RowError[] };

type MusicCsvRecord = Record<(typeof MUSIC_ITEM_IMPORT_HEADER)[number], string>;

/** A row's `file` metadata this module fills in on its own, so validateMusicItem's rangeRequired condition is true without this module ever knowing a real MIME type or byte size (see the module docblock). */
const PLACEHOLDER_FILE = { type: "audio/mpeg", size: 0 };

function fileError(message: string): ParseMusicItemsCsvResult {
  return { ok: false, errors: [{ row: 0, field: "file", message }] };
}

function headerError(): ParseMusicItemsCsvResult {
  return { ok: false, errors: [{ row: 0, field: "header", message: "musicImport.errors.header" }] };
}

function parseLocales(raw: string): MusicItemTranslations | null {
  const value = raw.trim();
  if (value === "nl") return { nl: {} };
  if (value === "en") return { en: {} };
  if (value === "nl;en" || value === "en;nl") return { nl: {}, en: {} };
  return null;
}

export function parseMusicItemsCsv(
  text: string,
  knownSubsubcategoryIds: ReadonlySet<string>,
): ParseMusicItemsCsvResult {
  let headerRow: string[];
  try {
    const headerPeek = parse(text, { ...PARSE_OPTIONS, to: 1 }) as string[][];
    headerRow = headerPeek[0] ?? [];
  } catch {
    return fileError("musicImport.errors.parseError");
  }

  if (headerRow.length === 0) {
    return fileError("musicImport.errors.empty");
  }

  const headerMatches =
    headerRow.length === MUSIC_ITEM_IMPORT_HEADER.length &&
    headerRow.every((cell, index) => cell === MUSIC_ITEM_IMPORT_HEADER[index]);
  if (!headerMatches) {
    return headerError();
  }

  let records: MusicCsvRecord[];
  try {
    records = parse(text, { ...PARSE_OPTIONS, columns: true }) as MusicCsvRecord[];
  } catch {
    return fileError("musicImport.errors.parseError");
  }

  if (records.length === 0) {
    return fileError("musicImport.errors.empty");
  }

  if (records.length > MUSIC_ITEM_IMPORT_MAX_ROWS) {
    return fileError("musicImport.errors.tooManyRows");
  }

  const errors: RowError[] = [];
  const rows: MusicCsvRow[] = [];

  records.forEach((record, index) => {
    const rowNumber = index + 1;

    if (record.file.trim() === "") {
      errors.push({ row: rowNumber, field: "file", message: "musicImport.errors.fileMissing" });
      return;
    }

    const translations = parseLocales(record.locales);
    if (!translations) {
      errors.push({ row: rowNumber, field: "locales", message: "musicImport.errors.locales" });
      return;
    }

    const formInput: MusicItemFormInput = {
      subsubcategoryId: record.subsubcategoryId,
      difficulty: record.difficulty,
      artist: record.artist,
      title: record.title,
      nlChecked: Boolean(translations.nl),
      enChecked: Boolean(translations.en),
      startSeconds: record.startSeconds,
      endSeconds: record.endSeconds,
      file: PLACEHOLDER_FILE,
    };

    const fieldErrors = validateMusicItem(formInput, knownSubsubcategoryIds, { fileRequired: false });
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
      artist: formInput.artist,
      title: formInput.title,
      startSeconds: Number(record.startSeconds),
      endSeconds: Number(record.endSeconds),
      translations,
    });
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, rows };
}
