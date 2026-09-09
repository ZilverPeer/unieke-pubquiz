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
  /** Unscoped, to resolve a row's fully-qualified message key. */
  tMessage: (key: string) => string;
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
              <td className="py-2">{columnForField(error.field) ?? ""}</td>
              <td className="py-2 text-red-600">{tMessage(error.message)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
