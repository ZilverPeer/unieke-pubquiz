/**
 * Pure CSV parsing for the Text Item bulk import (spec 4, ticket #94). No
 * database access -- src/app/admin/(shell)/items/import/actions.ts calls
 * this after loading the valid Subsubcategory ids, then writes the accepted
 * rows in one all-or-nothing write (see that file's docblock, "atomicity").
 * Row validation reuses validateTextItem (../items/validate.ts, ticket
 * #88's own rules for the single Text Item form) rather than duplicating
 * them here -- see admin-common brief and #80's story 30.
 *
 * The decided parse options (bom, skip_empty_lines, trim,
 * relax_column_count: false) are used for both calls below: a cheap
 * `to: 1` peek at the raw first row, to validate the header's exact order
 * and names before touching the rest of the file (a malformed or missing
 * header must never fall through to per-row validation), and the real
 * `columns: true` parse for the data rows once the header is known good.
 */
import { parse } from "csv-parse/sync";
import type { Difficulty } from "@/domain";
import { TEXT_ITEM_IMPORT_MAX_ROWS } from "@/domain";
import type { TextItemInput, TextItemTranslations } from "@/repository/admin/items";
import { validateTextItem, type TextItemFormInput } from "./validate";

/** Exact header the template route and this parser both use, in this order. */
export const TEXT_ITEM_IMPORT_HEADER = [
  "subsubcategoryId",
  "difficulty",
  "question_nl",
  "answer_nl",
  "fact_nl",
  "question_en",
  "answer_en",
  "fact_en",
] as const;

/**
 * validateTextItem's field keys (`nl.question`, `en.answer`, ...) are the
 * single Text Item form's own field names -- meaningless to an operator
 * looking at their own CSV file's columns. Maps each to the header column
 * it came from, so the row report can show what the operator actually
 * typed (fix round 1, PR #118). Lives next to TEXT_ITEM_IMPORT_HEADER
 * (the parser's own contract), not in the page component. `translations`
 * (validateTextItem's "at least one Locale required" error, not tied to
 * one column) and any other unmapped key -- including the file-level
 * "header"/"file" pseudo-fields -- have no CSV column and return `null`.
 */
const FIELD_TO_HEADER_COLUMN: Partial<Record<string, (typeof TEXT_ITEM_IMPORT_HEADER)[number]>> = {
  subsubcategoryId: "subsubcategoryId",
  difficulty: "difficulty",
  "nl.question": "question_nl",
  "nl.answer": "answer_nl",
  "nl.fact": "fact_nl",
  "en.question": "question_en",
  "en.answer": "answer_en",
  "en.fact": "fact_en",
};

export function csvColumnForField(field: string): string | null {
  return FIELD_TO_HEADER_COLUMN[field] ?? null;
}

export interface RowError {
  /** 1-based data row (header excluded); 0 for a file-level error. */
  row: number;
  field: string;
  /** A message key, resolved with next-intl in the page. */
  message: string;
}

export type ParseTextItemsCsvResult = { ok: true; rows: TextItemInput[] } | { ok: false; errors: RowError[] };

const PARSE_OPTIONS = {
  bom: true,
  skip_empty_lines: true,
  trim: true,
  relax_column_count: false,
} as const;

type TextItemRecord = Record<(typeof TEXT_ITEM_IMPORT_HEADER)[number], string>;

function fileError(message: string): ParseTextItemsCsvResult {
  return { ok: false, errors: [{ row: 0, field: "file", message }] };
}

function headerError(): ParseTextItemsCsvResult {
  return { ok: false, errors: [{ row: 0, field: "header", message: "itemsImport.errors.header" }] };
}

/**
 * Mirrors src/app/admin/(shell)/items/actions.ts's buildTranslations: a
 * Locale is only included when both question and answer are filled
 * (validateTextItem already refused a half-filled Locale before this runs).
 */
function buildTranslations(input: TextItemFormInput): TextItemTranslations {
  const translations: TextItemTranslations = {};
  for (const locale of ["nl", "en"] as const) {
    const { question, answer, fact } = input[locale];
    if (question.trim() && answer.trim()) {
      translations[locale] = { question, answer, fact: fact.trim() ? fact : undefined };
    }
  }
  return translations;
}

export function parseTextItemsCsv(text: string, knownSubsubcategoryIds: ReadonlySet<string>): ParseTextItemsCsvResult {
  let headerRow: string[];
  try {
    const headerPeek = parse(text, { ...PARSE_OPTIONS, to: 1 }) as string[][];
    headerRow = headerPeek[0] ?? [];
  } catch {
    return fileError("itemsImport.errors.parseError");
  }

  if (headerRow.length === 0) {
    return fileError("itemsImport.errors.empty");
  }

  const headerMatches =
    headerRow.length === TEXT_ITEM_IMPORT_HEADER.length &&
    headerRow.every((cell, index) => cell === TEXT_ITEM_IMPORT_HEADER[index]);
  if (!headerMatches) {
    return headerError();
  }

  let records: TextItemRecord[];
  try {
    records = parse(text, { ...PARSE_OPTIONS, columns: true }) as TextItemRecord[];
  } catch {
    return fileError("itemsImport.errors.parseError");
  }

  if (records.length === 0) {
    return fileError("itemsImport.errors.empty");
  }

  if (records.length > TEXT_ITEM_IMPORT_MAX_ROWS) {
    return fileError("itemsImport.errors.tooManyRows");
  }

  const errors: RowError[] = [];
  const rows: TextItemInput[] = [];

  records.forEach((record, index) => {
    const rowNumber = index + 1;
    const formInput: TextItemFormInput = {
      subsubcategoryId: record.subsubcategoryId,
      difficulty: record.difficulty,
      nl: { question: record.question_nl, answer: record.answer_nl, fact: record.fact_nl },
      en: { question: record.question_en, answer: record.answer_en, fact: record.fact_en },
    };

    const fieldErrors = validateTextItem(formInput, knownSubsubcategoryIds);
    if (fieldErrors) {
      for (const [field, message] of Object.entries(fieldErrors)) {
        errors.push({ row: rowNumber, field, message });
      }
      return;
    }

    rows.push({
      subsubcategoryId: formInput.subsubcategoryId,
      difficulty: formInput.difficulty as Difficulty,
      translations: buildTranslations(formInput),
    });
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, rows };
}
