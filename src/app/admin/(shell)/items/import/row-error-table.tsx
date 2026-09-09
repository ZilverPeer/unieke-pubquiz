"use client";
/**
 * Row error report table, shared by the Text and Picture bulk import forms
 * (spec 4, tickets #94/#95) -- extracted from the Text import's own
 * import-form.tsx so the Picture import does not duplicate it (ticket #95's
 * decision "the row-error table is extracted from import-form.tsx"). Row
 * errors are encoded as `rows.<n>.<field>` keys exactly as both actions
 * produce them (see either action's own docblock); splitFieldErrors parses
 * that flat FieldErrors shape back into a file-error list and a row-error
 * list, and RowErrorTable renders the row list as a table.
 *
 * `t` resolves this table's own labels (row/field/reason, report title) and
 * is always the "itemsImport" namespace's `report.*` keys -- the Picture
 * import page passes a translator scoped to "itemsImport" for this table
 * even though its own copy lives under "pictureImport", reusing the labels
 * rather than duplicating them (ticket #95 decision). `tMessage` is
 * unscoped (the whole messages tree), the same reasoning as import-form.tsx
 * originally had: a row's `message` is a fully-qualified key
 * ("items.errors.X", "pictureItems.errors.file.X", "pictureImport.errors.X")
 * that a namespace-scoped translator cannot resolve.
 *
 * A row-0 error's `field` is not always a form field: the Picture import's
 * "unreferenced zip entry" check (fileUnused) has no row to blame, so it
 * encodes the entry's own file name as `field` instead (`rows.0.<name>`,
 * see the Picture import action's own docblock). `columnForField` never has
 * a CSV column for an arbitrary file name, so this table falls back to the
 * raw field text rather than rendering blank (Standards review, fix round
 * 1) and passes it through to `tMessage` as the `file` interpolation value
 * for every row-0 error -- `pictureImport.errors.fileUnused` uses it,
 * ordinary field keys (which have no `{file}` placeholder) simply ignore
 * the extra value.
 */
import type { FieldErrors } from "@/admin/forms";

export interface FileError {
  field: string;
  message: string;
}

export interface RowError {
  row: number;
  field: string;
  message: string;
}

const ROW_ERROR_KEY = /^rows\.(\d+)\.(.+)$/;

export function splitFieldErrors(errors: FieldErrors): { fileErrors: FileError[]; rowErrors: RowError[] } {
  const fileErrors: FileError[] = [];
  const rowErrors: RowError[] = [];

  for (const [key, message] of Object.entries(errors)) {
    const match = ROW_ERROR_KEY.exec(key);
    if (match) {
      rowErrors.push({ row: Number(match[1]), field: match[2], message });
    } else {
      fileErrors.push({ field: key, message });
    }
  }

  rowErrors.sort((a, b) => a.row - b.row || a.field.localeCompare(b.field));
  return { fileErrors, rowErrors };
}

export interface RowErrorTableProps {
  rowErrors: RowError[];
  /** Maps a row error's field key to the CSV column an operator recognises, or null when there is none. */
  columnForField: (field: string) => string | null;
  /** Scoped to "itemsImport", for this table's own report.* labels (reused, never duplicated). */
  t: (key: string) => string;
  /** Unscoped, to resolve a row's fully-qualified message key; accepts ICU values for the `{file}` placeholder a row-0 error's message may carry. */
  tMessage: (key: string, values?: Record<string, string | number>) => string;
}

export function RowErrorTable({ rowErrors, columnForField, t, tMessage }: RowErrorTableProps) {
  if (rowErrors.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-semibold">{t("report.title")}</h2>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b">
            <th className="py-2">{t("report.row")}</th>
            <th className="py-2">{t("report.field")}</th>
            <th className="py-2">{t("report.reason")}</th>
          </tr>
        </thead>
        <tbody>
          {rowErrors.map((error) => (
            <tr key={`${error.row}-${error.field}`} className="border-b">
              <td className="py-2">{error.row}</td>
              <td className="py-2">{columnForField(error.field) ?? error.field}</td>
              <td className="py-2 text-red-600">
                {error.row === 0 ? tMessage(error.message, { file: error.field }) : tMessage(error.message)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
