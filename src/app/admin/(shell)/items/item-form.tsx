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
 * question/answer inputs per Locale (question hides for Picture and Music,
 * answer hides only for Music -- Picture Items keep an answer, CONTEXT.md
 * "Item storage shape"). The kind-specific fields (MusicFields,
 * PictureFields) are imported and rendered by THIS component, not passed
 * in as JSX: `kindProps` carries only the kind's serializable initial
 * values (fix round on PR 116 -- a `kindFields?: ReactNode` slot built
 * once on the server with `errors={{}}` could never show a validation
 * error after a failed submit, since `errors` only exists inside this
 * client component's own `useActionState`, not in the server page that
 * would have had to rebuild the JSX). Text stays the default so the
 * existing text pages keep working unchanged.
 *
 * Every error value in `errors` is a full message key from the messages
 * root (e.g. "items.errors.subsubcategoryRequired",
 * "musicItems.errors.artist.required"), so every error here is resolved
 * with a root-scoped `useTranslations()` (`tRoot`) rather than one
 * scoped to a single namespace -- closes the #88 defect where
 * `useTranslations("items")` was called with a key that already repeated
 * the "items." prefix and so never resolved.
 *
 * PictureFields (ticket #90) takes the same `errors: FieldErrors` prop as
 * MusicFields (ticket #119), passed the live `errors` from this component's
 * own `useActionState`.
 */
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ActionResult, FieldErrors } from "@/admin/forms";
import type { ItemKind } from "@/domain";
import type { SubsubcategoryOption } from "@/repository/admin/items";
import { createTextItem, updateTextItem } from "./actions";
import { createMusicItem, updateMusicItem } from "./music-actions";
import { MusicFields } from "./music-fields";
import { createPictureItem, updatePictureItem } from "./picture-actions";
import { PictureFields } from "./picture-fields";

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

/** Music kind's serializable initial values, passed straight through to MusicFields as props (plus the live `errors`). */
export interface MusicKindProps {
  artist: string;
  title: string;
  /** Signed URL of the currently stored clip; only present in edit mode. */
  clipUrl?: string;
}

/** Picture kind's serializable initial values, passed straight through to PictureFields as props (ticket #90). */
export interface PictureKindProps {
  /** Signed URL of the currently stored image; only present in edit mode. */
  imageUrl?: string;
}

export type ItemFormKindProps = MusicKindProps | PictureKindProps;

export interface ItemFormProps {
  mode: "create" | "edit";
  itemId?: string;
  kind: ItemKind;
  subsubcategoryOptions: SubsubcategoryOption[];
  initialValues?: ItemFormInitialValues;
  kindProps?: ItemFormKindProps;
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
 * untouched). Each kind ticket adds its own entry here -- items-kind-common
 * brief "Shared files", resolved by hand across #90/#91 during the merge.
 */
const ACTIONS: Partial<Record<ItemKind, ActionPair>> = {
  picture: [createPictureItem, updatePictureItem],
  music: [createMusicItem, updateMusicItem],
};

export function ItemForm({ mode, itemId, kind, subsubcategoryOptions, initialValues, kindProps }: ItemFormProps) {
  const t = useTranslations("items");
  const tRoot = useTranslations();
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

  const errors: FieldErrors = state && !state.ok ? state.errors : {};
  const values = initialValues ?? { subsubcategoryId: "", difficulty: "", nl: EMPTY_LOCALE, en: EMPTY_LOCALE };
  const musicProps = kind === "music" ? (kindProps as MusicKindProps | undefined) : undefined;
  const pictureProps = kind === "picture" ? (kindProps as PictureKindProps | undefined) : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {errors.translations ? <p className="text-red-600">{tRoot(errors.translations)}</p> : null}

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
        {errors.subsubcategoryId ? <span className="text-red-600">{tRoot(errors.subsubcategoryId)}</span> : null}
      </label>

      <label className="flex flex-col gap-1">
        <span>{t("form.difficulty")}</span>
        <select name="difficulty" defaultValue={values.difficulty} className="border px-2 py-1">
          <option value="">{t("form.subsubcategoryPlaceholder")}</option>
          <option value="easy">{t("form.difficultyEasy")}</option>
          <option value="medium">{t("form.difficultyMedium")}</option>
          <option value="hard">{t("form.difficultyHard")}</option>
        </select>
        {errors.difficulty ? <span className="text-red-600">{tRoot(errors.difficulty)}</span> : null}
      </label>

      {(["nl", "en"] as const).map((locale) => (
        <fieldset key={locale} className="flex flex-col gap-2 border p-3">
          <legend>{t(locale === "nl" ? "form.localeNl" : "form.localeEn")}</legend>

          {kind === "music" ? (
            <label className="flex items-center gap-2">
              <input type="checkbox" name={`${locale}.included`} defaultChecked={values[locale].included} />
              <span>{tRoot("musicItems.fields.locales")}</span>
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
                <span className="text-red-600">{tRoot(errors[`${locale}.question`])}</span>
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
              {errors[`${locale}.answer`] ? (
                <span className="text-red-600">{tRoot(errors[`${locale}.answer`])}</span>
              ) : null}
            </label>
          ) : null}

          <label className="flex flex-col gap-1">
            <span>{t("form.fact")}</span>
            <textarea name={`${locale}.fact`} defaultValue={values[locale].fact} className="border px-2 py-1" />
          </label>
        </fieldset>
      ))}

      {kind === "music" ? (
        <fieldset className="flex flex-col gap-2 border p-3">
          <MusicFields
            mode={mode}
            artist={musicProps?.artist ?? ""}
            title={musicProps?.title ?? ""}
            clipUrl={musicProps?.clipUrl}
            errors={errors}
          />
        </fieldset>
      ) : null}
      {kind === "picture" ? (
        <fieldset className="flex flex-col gap-2 border p-3">
          <PictureFields currentImageUrl={pictureProps?.imageUrl} errors={errors} />
        </fieldset>
      ) : null}

      <div className="flex gap-3">
        <button type="submit" disabled={pending} className="border px-3 py-1">
          {t(mode === "create" ? "form.submitCreate" : "form.submitUpdate")}
        </button>
      </div>
    </form>
  );
}
