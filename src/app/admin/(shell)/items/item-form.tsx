"use client";
/**
 * Shared Text Item create/edit form (spec 4, ticket #88). A client
 * component (not a plain progressive-enhancement form) because it needs
 * useActionState to read the ActionResult the server action returns --
 * field errors, resolved to message keys here with useTranslations (the
 * shape admin-common's brief describes) -- and to redirect to the list on
 * success itself, since createTextItem/updateTextItem return an
 * ActionResult rather than calling redirect() (the integration suite calls
 * them directly and asserts on that return value).
 */
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ActionResult } from "@/admin/forms";
import type { SubsubcategoryOption } from "@/repository/admin/items";
import { createTextItem, updateTextItem } from "./actions";

export interface ItemFormLocaleValues {
  question: string;
  answer: string;
  fact: string;
}

export interface ItemFormInitialValues {
  subsubcategoryId: string;
  difficulty: string;
  nl: ItemFormLocaleValues;
  en: ItemFormLocaleValues;
}

export interface ItemFormProps {
  mode: "create" | "edit";
  itemId?: string;
  subsubcategoryOptions: SubsubcategoryOption[];
  initialValues?: ItemFormInitialValues;
}

const EMPTY_LOCALE: ItemFormLocaleValues = { question: "", answer: "", fact: "" };

type FormState = ActionResult<{ id: string }> | null;

export function ItemForm({ mode, itemId, subsubcategoryOptions, initialValues }: ItemFormProps) {
  const t = useTranslations("items");
  const router = useRouter();

  async function submit(_previous: FormState, formData: FormData): Promise<FormState> {
    return mode === "create" ? createTextItem(formData) : updateTextItem(itemId!, formData);
  }

  const [state, formAction, pending] = useActionState<FormState, FormData>(submit, null);

  useEffect(() => {
    if (state?.ok) {
      router.push("/admin/items");
    }
  }, [state, router]);

  const errors = state && !state.ok ? state.errors : {};
  const values = initialValues ?? { subsubcategoryId: "", difficulty: "", nl: EMPTY_LOCALE, en: EMPTY_LOCALE };

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-gray-500">{t("form.kindNote")}</p>

      {errors.translations ? <p className="text-red-600">{t(errors.translations)}</p> : null}

      <label className="flex flex-col gap-1">
        <span>{t("form.subsubcategory")}</span>
        <select name="subsubcategoryId" defaultValue={values.subsubcategoryId} className="border px-2 py-1">
          <option value="">{t("form.subsubcategoryPlaceholder")}</option>
          {subsubcategoryOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.path}
            </option>
          ))}
        </select>
        {errors.subsubcategoryId ? <span className="text-red-600">{t(errors.subsubcategoryId)}</span> : null}
      </label>

      <label className="flex flex-col gap-1">
        <span>{t("form.difficulty")}</span>
        <select name="difficulty" defaultValue={values.difficulty} className="border px-2 py-1">
          <option value="">{t("form.subsubcategoryPlaceholder")}</option>
          <option value="easy">{t("form.difficultyEasy")}</option>
          <option value="medium">{t("form.difficultyMedium")}</option>
          <option value="hard">{t("form.difficultyHard")}</option>
        </select>
        {errors.difficulty ? <span className="text-red-600">{t(errors.difficulty)}</span> : null}
      </label>

      {(["nl", "en"] as const).map((locale) => (
        <fieldset key={locale} className="flex flex-col gap-2 border p-3">
          <legend>{t(locale === "nl" ? "form.localeNl" : "form.localeEn")}</legend>

          <label className="flex flex-col gap-1">
            <span>{t("form.question")}</span>
            <input
              type="text"
              name={`${locale}.question`}
              defaultValue={values[locale].question}
              className="border px-2 py-1"
            />
            {errors[`${locale}.question`] ? <span className="text-red-600">{t(errors[`${locale}.question`])}</span> : null}
          </label>

          <label className="flex flex-col gap-1">
            <span>{t("form.answer")}</span>
            <input
              type="text"
              name={`${locale}.answer`}
              defaultValue={values[locale].answer}
              className="border px-2 py-1"
            />
            {errors[`${locale}.answer`] ? <span className="text-red-600">{t(errors[`${locale}.answer`])}</span> : null}
          </label>

          <label className="flex flex-col gap-1">
            <span>{t("form.fact")}</span>
            <textarea name={`${locale}.fact`} defaultValue={values[locale].fact} className="border px-2 py-1" />
          </label>
        </fieldset>
      ))}

      <div className="flex gap-3">
        <button type="submit" disabled={pending} className="border px-3 py-1">
          {t(mode === "create" ? "form.submitCreate" : "form.submitUpdate")}
        </button>
      </div>
    </form>
  );
}
