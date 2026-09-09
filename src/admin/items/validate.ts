/**
 * Pure validation for the Text Item create/edit form (spec 4, ticket #88).
 * No database access -- the action calls this after loading the valid
 * Subsubcategory ids and passes them in, then returns `fail(errors)`
 * untouched (src/admin/forms.ts). Error values are message keys, resolved
 * with next-intl in the page.
 */
import type { Difficulty } from "@/domain";
import type { FieldErrors } from "@/admin/forms";

export interface LocaleTextInput {
  question: string;
  answer: string;
  fact: string;
}

export interface TextItemFormInput {
  subsubcategoryId: string;
  difficulty: string;
  nl: LocaleTextInput;
  en: LocaleTextInput;
}

export const DIFFICULTIES: ReadonlySet<string> = new Set<Difficulty>(["easy", "medium", "hard"]);

/**
 * The Subsubcategory/Difficulty checks every Item kind's form shares
 * (additive, ticket #91): reused as-is by validate-music.ts and, later,
 * validate-picture.ts, so the "choose a valid Subsubcategory/Difficulty"
 * rule and its message keys live in exactly one place.
 */
export function validateSubsubcategoryAndDifficulty(
  subsubcategoryId: string,
  difficulty: string,
  validSubsubcategoryIds: ReadonlySet<string>,
): FieldErrors {
  const errors: FieldErrors = {};

  if (!subsubcategoryId || !validSubsubcategoryIds.has(subsubcategoryId)) {
    errors.subsubcategoryId = "items.errors.subsubcategoryRequired";
  }

  if (!DIFFICULTIES.has(difficulty)) {
    errors.difficulty = "items.errors.difficultyRequired";
  }

  return errors;
}

export function validateTextItem(
  input: TextItemFormInput,
  validSubsubcategoryIds: ReadonlySet<string>,
): FieldErrors | null {
  const errors: FieldErrors = validateSubsubcategoryAndDifficulty(
    input.subsubcategoryId,
    input.difficulty,
    validSubsubcategoryIds,
  );

  let completeLocales = 0;
  for (const locale of ["nl", "en"] as const) {
    const { question, answer } = input[locale];
    const hasQuestion = question.trim().length > 0;
    const hasAnswer = answer.trim().length > 0;

    if (!hasQuestion && !hasAnswer) continue;

    if (hasQuestion && hasAnswer) {
      completeLocales++;
      continue;
    }

    if (!hasQuestion) errors[`${locale}.question`] = "items.errors.localeIncomplete";
    if (!hasAnswer) errors[`${locale}.answer`] = "items.errors.localeIncomplete";
  }

  if (completeLocales === 0 && !errors["nl.question"] && !errors["nl.answer"] && !errors["en.question"] && !errors["en.answer"]) {
    errors.translations = "items.errors.atLeastOneLocaleRequired";
  }

  return Object.keys(errors).length > 0 ? errors : null;
}
