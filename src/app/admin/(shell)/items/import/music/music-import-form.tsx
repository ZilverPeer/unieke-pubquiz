"use client";
/**
 * Music Item bulk import form (spec 4, ticket #96). The Music sibling of
 * ../pictures/picture-import-form.tsx: two file inputs (`csv`, `zip`), the
 * same useActionState/row-report shape, reusing splitFieldErrors and
 * RowErrorTable from ../row-error-table.tsx rather than duplicating them.
 *
 * Two translators: `t` scoped to "musicImport" for this page's own copy;
 * `tReport` scoped to "itemsImport" so RowErrorTable's report.* labels are
 * reused, not duplicated; `tMessage` unscoped, to resolve the fully-
 * qualified message keys a row's `message` carries ("items.errors.X",
 * "musicItems.errors.X", "musicImport.errors.X").
 */
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { ActionResult } from "@/admin/forms";
import { musicCsvColumnForField } from "@/admin/items/import-music-csv";
import { RowErrorTable, splitFieldErrors } from "../row-error-table";
import { importMusicItems } from "./actions";

type FormState = ActionResult<{ count: number }> | null;

export function MusicImportForm() {
  const t = useTranslations("musicImport");
  const tReport = useTranslations("itemsImport");
  const tMessage = useTranslations();

  async function submit(_previous: FormState, formData: FormData): Promise<FormState> {
    return importMusicItems(formData);
  }

  const [state, formAction, pending] = useActionState<FormState, FormData>(submit, null);

  const { fileErrors, rowErrors } = state && !state.ok ? splitFieldErrors(state.errors) : { fileErrors: [], rowErrors: [] };

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span>{t("form.csvLabel")}</span>
          <input type="file" name="csv" accept=".csv,text/csv" className="border px-2 py-1" required />
        </label>
        <label className="flex flex-col gap-1">
          <span>{t("form.zipLabel")}</span>
          <input type="file" name="zip" accept=".zip,application/zip" className="border px-2 py-1" required />
        </label>
        <button type="submit" disabled={pending} className="self-start border px-3 py-1">
          {t("form.submit")}
        </button>
      </form>

      {state?.ok ? <p className="text-green-700">{t("success", { count: state.value.count })}</p> : null}

      {fileErrors.length > 0 ? (
        <div className="flex flex-col gap-1 text-red-600">
          {fileErrors.map((error) => (
            <p key={error.field}>{tMessage(error.message)}</p>
          ))}
        </div>
      ) : null}

      <RowErrorTable rowErrors={rowErrors} columnForField={musicCsvColumnForField} t={tReport} tMessage={tMessage} />
    </div>
  );
}
