/**
 * Pure validation for the Music Item create/edit form (spec 4, ticket #91).
 * No database access, no ffmpeg -- the action calls this after loading the
 * valid Subsubcategory ids and passes them in, then returns `fail(errors)`
 * untouched (src/admin/forms.ts). Error values are message keys, resolved
 * with next-intl in the page. Reuses validateSubsubcategoryAndDifficulty
 * from validate.ts (the items-kind-common brief's "reuse the Locale
 * rules" -- Music Items have no question/answer Locale rule to reuse, so
 * this is the one rule that is actually shared).
 */
import { MUSIC_CLIP_MAX_SECONDS, MUSIC_CLIP_MIN_SECONDS, MUSIC_UPLOAD_MAX_BYTES } from "@/domain";
import type { FieldErrors } from "@/admin/forms";
import { validateSubsubcategoryAndDifficulty } from "./validate";

/** Every MIME type ffmpeg is expected to read for the full-song upload (items-kind-common brief). */
const ALLOWED_MUSIC_MIME_TYPES: ReadonlySet<string> = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/flac",
  "audio/ogg",
  "audio/mp4",
  "audio/x-m4a",
]);

export interface MusicItemFileInput {
  type: string;
  size: number;
}

export interface MusicItemFormInput {
  subsubcategoryId: string;
  difficulty: string;
  artist: string;
  title: string;
  /** Whether the operator ticked the Locale checkbox (a Locale is "present" for Music only when ticked). */
  nlChecked: boolean;
  enChecked: boolean;
  startSeconds: string;
  endSeconds: string;
  /** null when no file was chosen this submit -- always given on create, optional on update. */
  file: MusicItemFileInput | null;
}

export interface ValidateMusicItemOptions {
  /** true on create (a file is mandatory); false on update (a file only re-cuts when given). */
  fileRequired: boolean;
}

export function validateMusicItem(
  input: MusicItemFormInput,
  validSubsubcategoryIds: ReadonlySet<string>,
  options: ValidateMusicItemOptions,
): FieldErrors | null {
  const errors: FieldErrors = validateSubsubcategoryAndDifficulty(
    input.subsubcategoryId,
    input.difficulty,
    validSubsubcategoryIds,
  );

  if (!input.artist.trim()) {
    errors.artist = "musicItems.errors.artist.required";
  }
  if (!input.title.trim()) {
    errors.title = "musicItems.errors.title.required";
  }

  if (!input.nlChecked && !input.enChecked) {
    errors.translations = "musicItems.errors.translations.atLeastOneLocaleRequired";
  }

  const hasFile = input.file !== null;
  if (!hasFile && options.fileRequired) {
    errors.file = "musicItems.errors.file.required";
  }

  // The cut range is required whenever a file will actually be cut (always
  // on create, and on update only when a new file was given) -- see the
  // ticket brief: "the file: required on create, optional on update, but
  // when present on update start and end are required".
  const rangeRequired = options.fileRequired || hasFile;
  if (rangeRequired) {
    const startProvided = input.startSeconds.trim() !== "";
    const endProvided = input.endSeconds.trim() !== "";
    const start = Number(input.startSeconds);
    const end = Number(input.endSeconds);
    const validNumbers = startProvided && endProvided && Number.isFinite(start) && Number.isFinite(end);

    if (!validNumbers || start < 0 || start >= end) {
      errors.endSeconds = "musicItems.errors.range.order";
    } else {
      const length = end - start;
      if (length < MUSIC_CLIP_MIN_SECONDS || length > MUSIC_CLIP_MAX_SECONDS) {
        errors.endSeconds = "musicItems.errors.range.length";
      }
    }
  }

  if (hasFile && !errors.file) {
    const file = input.file!;
    if (!ALLOWED_MUSIC_MIME_TYPES.has(file.type)) {
      errors.file = "musicItems.errors.file.type";
    } else if (file.size > MUSIC_UPLOAD_MAX_BYTES) {
      errors.file = "musicItems.errors.file.size";
    }
  }

  return Object.keys(errors).length > 0 ? errors : null;
}
