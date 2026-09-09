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

const DIFFICULTIES: ReadonlySet<string> = new Set<Difficulty>(["easy", "medium", "hard"]);

/**
 * Shared Subsubcategory rule -- exported (additive) so the Picture and
 * Music Item validation modules reuse it instead of a second copy
 * (items-kind-common brief "reuse the Locale rules from validate.ts").
 */
export function validateSubsubcategoryId(
  subsubcategoryId: string,
  validSubsubcategoryIds: ReadonlySet<string>,
): string | null {
  if (!subsubcategoryId || !validSubsubcategoryIds.has(subsubcategoryId)) {
    return "items.errors.subsubcategoryRequired";
  }
  return null;
}

/** Shared Difficulty rule, same reuse reasoning as validateSubsubcategoryId. */
export function validateDifficulty(difficulty: string): string | null {
  return DIFFICULTIES.has(difficulty) ? null : "items.errors.difficultyRequired";
}

export function validateTextItem(
  input: TextItemFormInput,
  validSubsubcategoryIds: ReadonlySet<string>,
): FieldErrors | null {
  const errors: FieldErrors = {};

  const subsubcategoryError = validateSubsubcategoryId(input.subsubcategoryId, validSubsubcategoryIds);
  if (subsubcategoryError) errors.subsubcategoryId = subsubcategoryError;

  const difficultyError = validateDifficulty(input.difficulty);
  if (difficultyError) errors.difficulty = difficultyError;

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
