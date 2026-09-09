/**
 * Pure validation for the Picture Item create/edit form (spec 4, ticket
 * #90). No database access, no file-content inspection -- the action calls
 * this after loading the valid Subsubcategory ids and passes them in, then
 * returns `fail(errors)` untouched (src/admin/forms.ts). Whether the
 * uploaded bytes really are an image is checked in the repository call
 * (`sharp(buffer).metadata()`), not here (items-kind-common brief); this
 * module only checks what a `File` header claims (MIME, size) and presence.
 *
 * Subsubcategory and Difficulty reuse validate.ts's exported helpers
 * (items-kind-common brief "reuse the Locale rules from validate.ts").
 * Picture Items have no question -- the per-Locale rule here is "Answer
 * required, or the Locale entirely empty" rather than Text's
 * "question and answer both required".
 */
import type { FieldErrors } from "@/admin/forms";
import { validateDifficulty, validateSubsubcategoryId } from "./validate";

export const PICTURE_ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg"]);
export const PICTURE_MAX_FILE_BYTES = 5 * 1024 * 1024;

export interface LocalePictureInput {
  answer: string;
  fact: string;
}

export interface PictureItemFormInput {
  subsubcategoryId: string;
  difficulty: string;
  nl: LocalePictureInput;
  en: LocalePictureInput;
  /** `null` when no new file was submitted (allowed on update, not on create). */
  file: { type: string; size: number } | null;
  /** `true` on create (a file is mandatory); `false` on update (replacing is optional). */
  fileRequired: boolean;
}

export function validatePictureItem(
  input: PictureItemFormInput,
  validSubsubcategoryIds: ReadonlySet<string>,
): FieldErrors | null {
  const errors: FieldErrors = {};

  const subsubcategoryError = validateSubsubcategoryId(input.subsubcategoryId, validSubsubcategoryIds);
  if (subsubcategoryError) errors.subsubcategoryId = subsubcategoryError;

  const difficultyError = validateDifficulty(input.difficulty);
  if (difficultyError) errors.difficulty = difficultyError;

  let completeLocales = 0;
  for (const locale of ["nl", "en"] as const) {
    const { answer, fact } = input[locale];
    const hasAnswer = answer.trim().length > 0;
    const hasFact = fact.trim().length > 0;

    if (!hasAnswer && !hasFact) continue;

    if (hasAnswer) {
      completeLocales++;
      continue;
    }

    errors[`${locale}.answer`] = "items.errors.localeIncomplete";
  }

  if (completeLocales === 0 && !errors["nl.answer"] && !errors["en.answer"]) {
    errors.translations = "items.errors.atLeastOneLocaleRequired";
  }

  if (!input.file) {
    if (input.fileRequired) errors.file = "pictureItems.errors.file.required";
  } else if (!PICTURE_ALLOWED_MIME_TYPES.has(input.file.type)) {
    errors.file = "pictureItems.errors.file.type";
  } else if (input.file.size > PICTURE_MAX_FILE_BYTES) {
    errors.file = "pictureItems.errors.file.size";
  }

  return Object.keys(errors).length > 0 ? errors : null;
}
