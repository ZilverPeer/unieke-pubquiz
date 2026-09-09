"use client";
/**
 * Kind-specific inputs for the Music Item form (spec 4, ticket #91),
 * rendered by item-form.tsx itself (not passed in as JSX -- fix round on
 * PR 116: a `kindFields?: ReactNode` slot built once on the server with
 * `errors={{}}` can never show a validation error after a failed submit,
 * since the page only renders once per navigation while `errors` changes
 * on every `useActionState` update inside the client-only ItemForm). A
 * client component: the file-choice preview plays through
 * `URL.createObjectURL` before upload, and the "use current time" buttons
 * read `audio.currentTime` off that same element -- both need the
 * browser's Audio element, so this can't be a server component
 * (items-kind-common brief).
 *
 * Error message keys in `errors` are full paths from the messages root
 * (e.g. "musicItems.errors.artist.required", written that way by
 * validate-music.ts), so this component resolves them with an unscoped
 * `useTranslations()` rather than one scoped to the "musicItems"
 * namespace -- see the PR body for the same fix applied to
 * item-form.tsx's shared-field errors (closes the #88 defect there).
 */
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { FieldErrors } from "@/admin/forms";

export interface MusicFieldsProps {
  mode: "create" | "edit";
  artist: string;
  title: string;
  /** Signed URL of the currently stored clip; only present in edit mode. */
  clipUrl?: string;
  errors: FieldErrors;
}

export function MusicFields({ mode, artist, title, clipUrl, errors }: MusicFieldsProps) {
  const t = useTranslations("musicItems");
  const tError = useTranslations();

  const audioRef = useRef<HTMLAudioElement>(null);
  const startInputRef = useRef<HTMLInputElement>(null);
  const endInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Revoke the last object URL on unmount too, not only on the next file
  // choice -- otherwise navigating away with a preview still selected
  // leaks it for the life of the tab.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

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
        <input type="text" name="artist" defaultValue={artist} className="border px-2 py-1" />
        {errors.artist ? <span className="text-red-600">{tError(errors.artist)}</span> : null}
      </label>

      <label className="flex flex-col gap-1">
        <span>{t("fields.title")}</span>
        <input type="text" name="title" defaultValue={title} className="border px-2 py-1" />
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
          <input ref={startInputRef} type="number" name="startSeconds" step="0.1" className="border px-2 py-1" />
          <button type="button" onClick={() => applyCurrentTime(startInputRef)} className="w-fit border px-2 py-0.5 text-sm">
            {t("fields.useCurrentTimeStart")}
          </button>
        </label>

        <label className="flex flex-1 flex-col gap-1">
          <span>{t("fields.end")}</span>
          <input ref={endInputRef} type="number" name="endSeconds" step="0.1" className="border px-2 py-1" />
          <button type="button" onClick={() => applyCurrentTime(endInputRef)} className="w-fit border px-2 py-0.5 text-sm">
            {t("fields.useCurrentTimeEnd")}
          </button>
        </label>
      </div>
      {errors.endSeconds ? <span className="text-red-600">{tError(errors.endSeconds)}</span> : null}

      {clipUrl ? (
        <div className="flex flex-col gap-1">
          <span>{t("fields.currentClip")}</span>
          <audio controls src={clipUrl} />
        </div>
      ) : null}
    </div>
  );
}
