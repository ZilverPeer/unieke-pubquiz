"use client";
/**
 * Picture Item kind-specific form fields (spec 4, ticket #90): the file
 * input, plus, on edit, the current stored image. Rendered inside
 * item-form.tsx's shared `<fieldset>` via its `kindFields` prop
 * (items-kind-common brief "Shared files"). Picture Items have no
 * question -- item-form.tsx hides the shared question textarea when
 * `kind !== "text"`; the answer and fact inputs per Locale stay
 * (unchanged, shared with every other kind).
 *
 * `errors.file` (ticket #119) carries a full message key from the messages
 * root (e.g. "pictureItems.errors.file.required", written that way by
 * validate-picture.ts), so it is resolved with a root-scoped
 * `useTranslations()` (`tError`) rather than the "pictureItems"-scoped `t`
 * used for this component's own labels -- same pattern as MusicFields.
 */
import { useTranslations } from "next-intl";
import type { FieldErrors } from "@/admin/forms";

export interface PictureFieldsProps {
  /** Signed URL of the currently stored image; present only in edit mode. */
  currentImageUrl?: string;
  errors: FieldErrors;
}

export function PictureFields({ currentImageUrl, errors }: PictureFieldsProps) {
  const t = useTranslations("pictureItems");
  const tError = useTranslations();

  return (
    <div className="flex flex-col gap-2">
      {currentImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- admin-common brief: native <img>, no component library.
        <img src={currentImageUrl} alt={t("form.currentImageAlt")} className="max-h-64" />
      ) : null}
      <label className="flex flex-col gap-1">
        <span>{t(currentImageUrl ? "form.replaceLabel" : "form.fileLabel")}</span>
        <input type="file" name="file" accept="image/png,image/jpeg" className="border px-2 py-1" />
        {errors.file ? <span className="text-red-600">{tError(errors.file)}</span> : null}
      </label>
    </div>
  );
}
