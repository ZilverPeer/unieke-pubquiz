"use client";
/**
 * Shared Item create/edit form (spec 4, ticket #88; kind dispatch added by
 * tickets #90/#91, items-kind-common brief "Layout rules"). A client
 * component (not a plain progressive-enhancement form) because it needs
 * useActionState to read the ActionResult the server action returns --
 * field errors, resolved to message keys here with useTranslations (the
 * shape admin-common's brief describes) -- and to redirect to the list on
 * success itself, since every kind's actions return an ActionResult rather
 * than calling redirect() (the integration suites call them directly and
 * assert on that return value).
 *
 * `kind` selects the action pair through ACTIONS and hides/shows the
 * question/answer inputs per Locale; `kindFields` is the kind-specific
 * slot (music-fields.tsx, and later picture-fields.tsx) rendered in its
 * own fieldset just before the submit button. Text stays the default so
 * the existing text pages keep working unchanged.
 */
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { ActionResult } from "@/admin/forms";
import type { ItemKind } from "@/domain";
import type { SubsubcategoryOption } from "@/repository/admin/items";
import { createTextItem, updateTextItem } from "./actions";
import { createMusicItem, updateMusicItem } from "./music-actions";

export interface ItemFormLocaleValues {
  question: string;
  answer: string;
  fact: string;
  /** Music only: whether the operator ticked this Locale's checkbox (a Locale is "present" for Music only when ticked). */
  included?: boolean;
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
  kind: ItemKind;
  subsubcategoryOptions: SubsubcategoryOption[];
  initialValues?: ItemFormInitialValues;
  kindFields?: ReactNode;
}

const EMPTY_LOCALE: ItemFormLocaleValues = { question: "", answer: "", fact: "", included: false };

type FormState = ActionResult<{ id: string }> | null;

type ActionPair = [
  (formData: FormData) => Promise<FormState>,
  (id: string, formData: FormData) => Promise<FormState>,
];

/**
 * Kind -> [create, update] action pair, for every kind except "text"
 * (handled by its own branch below so the pre-existing text pages are
 * untouched). Each kind ticket adds its own entry here -- see the
 * items-kind-common brief "Shared files" for why this collides with
 * ticket #90 the same way and how the merge resolves it (keep both sides).
 */
const ACTIONS: Partial<Record<ItemKind, ActionPair>> = {
  music: [createMusicItem, updateMusicItem],
};

export function ItemForm({ mode, itemId, kind, subsubcategoryOptions, initialValues, kindFields }: ItemFormProps) {
  const t = useTranslations("items");
  const tMusic = useTranslations("musicItems");
  const router = useRouter();

  async function submit(_previous: FormState, formData: FormData): Promise<FormState> {
    if (kind === "text") {
      return mode === "create" ? createTextItem(formData) : updateTextItem(itemId!, formData);
    }
    const actions = ACTIONS[kind];
    if (!actions) throw new Error(`No admin form actions registered for Item kind "${kind}"`);
    const [create, update] = actions;
    return mode === "create" ? create(formData) : update(itemId!, formData);
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
      {kind === "text" ? <p className="text-gray-500">{t("form.kindNote")}</p> : null}

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

          {kind === "music" ? (
            <label className="flex items-center gap-2">
              <input type="checkbox" name={`${locale}.included`} defaultChecked={values[locale].included} />
              <span>{tMusic("fields.locales")}</span>
            </label>
          ) : null}

          {kind === "text" ? (
            <label className="flex flex-col gap-1">
              <span>{t("form.question")}</span>
              <input
                type="text"
                name={`${locale}.question`}
                defaultValue={values[locale].question}
                className="border px-2 py-1"
              />
              {errors[`${locale}.question`] ? (
                <span className="text-red-600">{t(errors[`${locale}.question`])}</span>
              ) : null}
            </label>
          ) : null}

          {kind !== "music" ? (
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
          ) : null}

          <label className="flex flex-col gap-1">
            <span>{t("form.fact")}</span>
            <textarea name={`${locale}.fact`} defaultValue={values[locale].fact} className="border px-2 py-1" />
          </label>
        </fieldset>
      ))}

      {kindFields ? <fieldset className="flex flex-col gap-2 border p-3">{kindFields}</fieldset> : null}

      <div className="flex gap-3">
        <button type="submit" disabled={pending} className="border px-3 py-1">
          {t(mode === "create" ? "form.submitCreate" : "form.submitUpdate")}
        </button>
      </div>
    </form>
  );
}
