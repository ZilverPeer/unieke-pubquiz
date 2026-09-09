"use client";
/**
 * Kind-specific inputs for the Music Item form (spec 4, ticket #91),
 * rendered inside item-form.tsx's shared `kindFields` slot. A client
 * component: the file-choice preview plays through `URL.createObjectURL`
 * before upload, and the "use current time" buttons read `audio.currentTime`
 * off that same element -- both need the browser's Audio element, so this
 * can't be a server component (items-kind-common brief).
 *
 * Error message keys in `errors` are full paths from the messages root
 * (e.g. "musicItems.errors.artist.required", written that way by
 * validate-music.ts), so this component resolves them with an unscoped
 * `useTranslations()` rather than one scoped to the "musicItems"
 * namespace -- see the PR body for the same observation about
 * item-form.tsx's shared-field errors.
 */
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { FieldErrors } from "@/admin/forms";

export interface MusicFieldsInitialValues {
  artist: string;
  title: string;
  startSeconds: string;
  endSeconds: string;
}

export interface MusicFieldsProps {
  mode: "create" | "edit";
  initialValues?: MusicFieldsInitialValues;
  errors: FieldErrors;
  /** Signed URL of the currently stored clip; only present in edit mode. */
  existingClipUrl?: string;
}

const EMPTY_VALUES: MusicFieldsInitialValues = { artist: "", title: "", startSeconds: "", endSeconds: "" };

export function MusicFields({ mode, initialValues, errors, existingClipUrl }: MusicFieldsProps) {
  const t = useTranslations("musicItems");
  const tError = useTranslations();
  const values = initialValues ?? EMPTY_VALUES;

  const audioRef = useRef<HTMLAudioElement>(null);
  const startInputRef = useRef<HTMLInputElement>(null);
  const endInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      const file = event.target.files?.[0];
      return file ? URL.createObjectURL(file) : null;
    });
  }

  function applyCurrentTime(target: React.RefObject<HTMLInputElement | null>) {
    const audio = audioRef.current;
    if (!audio || !target.current) return;
    target.current.value = audio.currentTime.toFixed(1);
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span>{t("fields.artist")}</span>
        <input type="text" name="artist" defaultValue={values.artist} className="border px-2 py-1" />
        {errors.artist ? <span className="text-red-600">{tError(errors.artist)}</span> : null}
      </label>

      <label className="flex flex-col gap-1">
        <span>{t("fields.title")}</span>
        <input type="text" name="title" defaultValue={values.title} className="border px-2 py-1" />
        {errors.title ? <span className="text-red-600">{tError(errors.title)}</span> : null}
      </label>

      <label className="flex flex-col gap-1">
        <span>{t("fields.file")}</span>
        <input
          type="file"
          name="file"
          accept="audio/*"
          required={mode === "create"}
          onChange={handleFileChange}
          className="border px-2 py-1"
        />
        {errors.file ? <span className="text-red-600">{tError(errors.file)}</span> : null}
      </label>

      {previewUrl ? (
        <div className="flex flex-col gap-1">
          <span>{t("fields.filePreview")}</span>
          <audio ref={audioRef} controls src={previewUrl} />
        </div>
      ) : null}

      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <span>{t("fields.start")}</span>
          <input
            ref={startInputRef}
            type="number"
            name="startSeconds"
            step="0.1"
            defaultValue={values.startSeconds}
            className="border px-2 py-1"
          />
          <button type="button" onClick={() => applyCurrentTime(startInputRef)} className="w-fit border px-2 py-0.5 text-sm">
            {t("fields.useCurrentTimeStart")}
          </button>
        </label>

        <label className="flex flex-1 flex-col gap-1">
          <span>{t("fields.end")}</span>
          <input
            ref={endInputRef}
            type="number"
            name="endSeconds"
            step="0.1"
            defaultValue={values.endSeconds}
            className="border px-2 py-1"
          />
          <button type="button" onClick={() => applyCurrentTime(endInputRef)} className="w-fit border px-2 py-0.5 text-sm">
            {t("fields.useCurrentTimeEnd")}
          </button>
        </label>
      </div>
      {errors.endSeconds ? <span className="text-red-600">{tError(errors.endSeconds)}</span> : null}

      {existingClipUrl ? (
        <div className="flex flex-col gap-1">
          <span>{t("fields.currentClip")}</span>
          <audio controls src={existingClipUrl} />
        </div>
      ) : null}
    </div>
  );
}
