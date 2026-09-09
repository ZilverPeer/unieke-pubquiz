"use client";
/**
 * Text Item bulk import form (spec 4, ticket #94). A client component (the
 * same shape as ../item-form.tsx) so useActionState can read the
 * ActionResult importTextItems returns -- the success count, or a row
 * error report parsed from the flat FieldErrors shape actions.ts encodes
 * ("<field>" for a file-level error, "rows.<n>.<field>" for a row error;
 * see that file's docblock). splitFieldErrors/RowErrorTable (./row-error-
 * table.tsx) are shared with the Picture import form (ticket #95); this
 * file only wires them up with its own translators.
 *
 * Two translators, deliberately: `t` is scoped to "itemsImport" for this
 * page's own copy (and, since the row-error table reuses its `report.*`
 * labels, for the table too); `tMessage` is unscoped (the whole messages
 * tree) to resolve the fully-qualified message keys FieldErrors carries
 * ("items.errors.X" from validateTextItem, "itemsImport.errors.X" from
 * this ticket's own file-level errors) -- a namespace-scoped translator
 * can only resolve keys relative to its own namespace, so calling
 * `useTranslations("itemsImport")` with an already-namespaced key like
 * "items.errors.subsubcategoryRequired" would look up
 * "itemsImport.items.errors.subsubcategoryRequired" and miss.
 *
 * The row report's "field" column shows the CSV header column the
 * operator actually typed (question_nl, fact_en, ...), not
 * validateTextItem's internal field key (nl.question, en.fact, ...) --
 * csvColumnForField (src/admin/items/import-csv.ts) is the mapping, kept
 * next to the header constant since that's the parser's own contract, not
 * this component's (fix round 1, PR #118).
 */
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { ActionResult } from "@/admin/forms";
import { csvColumnForField } from "@/admin/items/import-csv";
import { RowErrorTable, splitFieldErrors } from "./row-error-table";
import { importTextItems } from "./actions";

type FormState = ActionResult<{ count: number }> | null;

export function ImportForm() {
  const t = useTranslations("itemsImport");
  const tMessage = useTranslations();

  async function submit(_previous: FormState, formData: FormData): Promise<FormState> {
    return importTextItems(formData);
  }

  const [state, formAction, pending] = useActionState<FormState, FormData>(submit, null);

  const { fileErrors, rowErrors } = state && !state.ok ? splitFieldErrors(state.errors) : { fileErrors: [], rowErrors: [] };

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

      <RowErrorTable rowErrors={rowErrors} columnForField={csvColumnForField} t={t} tMessage={tMessage} />
    </div>
  );
}
