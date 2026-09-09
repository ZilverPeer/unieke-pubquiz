"use client";
/**
 * Text Item bulk import form (spec 4, ticket #94). A client component (the
 * same shape as ../item-form.tsx) so useActionState can read the
 * ActionResult importTextItems returns -- the success count, or a row
 * error report parsed from the flat FieldErrors shape actions.ts encodes
 * ("<field>" for a file-level error, "rows.<n>.<field>" for a row error;
 * see that file's docblock).
 *
 * Two translators, deliberately: `t` is scoped to "itemsImport" for this
 * page's own copy; `tMessage` is unscoped (the whole messages tree) to
 * resolve the fully-qualified message keys FieldErrors carries
 * ("items.errors.X" from validateTextItem, "itemsImport.errors.X" from
 * this ticket's own file-level errors) -- a namespace-scoped translator
 * can only resolve keys relative to its own namespace, so calling
 * `useTranslations("itemsImport")` with an already-namespaced key like
 * "items.errors.subsubcategoryRequired" would look up
 * "itemsImport.items.errors.subsubcategoryRequired" and miss.
 */
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { ActionResult, FieldErrors } from "@/admin/forms";
import { importTextItems } from "./actions";

type FormState = ActionResult<{ count: number }> | null;

interface FileError {
  field: string;
  message: string;
}

interface RowError {
  row: number;
  field: string;
  message: string;
}

const ROW_ERROR_KEY = /^rows\.(\d+)\.(.+)$/;

function splitErrors(errors: FieldErrors): { fileErrors: FileError[]; rowErrors: RowError[] } {
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

export function ImportForm() {
  const t = useTranslations("itemsImport");
  const tMessage = useTranslations();

  async function submit(_previous: FormState, formData: FormData): Promise<FormState> {
    return importTextItems(formData);
  }

  const [state, formAction, pending] = useActionState<FormState, FormData>(submit, null);

  const { fileErrors, rowErrors } = state && !state.ok ? splitErrors(state.errors) : { fileErrors: [], rowErrors: [] };

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span>{t("form.fileLabel")}</span>
          <input type="file" name="file" accept=".csv,text/csv" className="border px-2 py-1" required />
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

      {rowErrors.length > 0 ? (
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
                  <td className="py-2">{error.field}</td>
                  <td className="py-2 text-red-600">{tMessage(error.message)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
