"use server";
/**
 * Text Item create/edit server actions (spec 4, ticket #88). Re-checks the
 * operator through assertOperator() (src/admin/auth/session.ts) rather than
 * trusting that the page that rendered the form was itself guarded -- see
 * the admin-common brief "Tests": the `deps` parameter lets the integration
 * suite bypass the Supabase Auth session with a stub.
 */
import { revalidatePath } from "next/cache";
import type { Difficulty } from "@/domain";
import { assertOperator } from "@/admin/auth/session";
import { type ActionResult, fail, succeed } from "@/admin/forms";
import { type LocaleTextInput, type TextItemFormInput, validateTextItem } from "@/admin/items/validate";
import { createSupabaseClient, resolveLocalStackConfig } from "@/repository";
import {
  createTextItem as createTextItemRepo,
  loadSubsubcategoryOptions,
  updateTextItem as updateTextItemRepo,
  type TextItemInput,
  type TextItemTranslations,
} from "@/repository/admin/items";

export interface ActionDeps {
  assertOperator: typeof assertOperator;
}

const defaultDeps: ActionDeps = { assertOperator };

function readLocaleInput(formData: FormData, locale: "nl" | "en"): LocaleTextInput {
  return {
    question: String(formData.get(`${locale}.question`) ?? ""),
    answer: String(formData.get(`${locale}.answer`) ?? ""),
    fact: String(formData.get(`${locale}.fact`) ?? ""),
  };
}

function readFormInput(formData: FormData): TextItemFormInput {
  return {
    subsubcategoryId: String(formData.get("subsubcategoryId") ?? ""),
    difficulty: String(formData.get("difficulty") ?? ""),
    nl: readLocaleInput(formData, "nl"),
    en: readLocaleInput(formData, "en"),
  };
}

/**
 * revalidatePath() requires a Next.js request/render context; the
 * integration suite calls these actions directly with vitest, outside any
 * such context, where it throws "static generation store missing" -- a
 * no-op there is correct (there is no cached route render to invalidate).
 */
function revalidateItemsPaths(paths: string[]): void {
  try {
    for (const path of paths) revalidatePath(path);
  } catch {
    // No Next.js request context (e.g. this suite's direct vitest calls).
  }
}

function buildTranslations(input: TextItemFormInput): TextItemTranslations {
  const translations: TextItemTranslations = {};
  for (const locale of ["nl", "en"] as const) {
    const { question, answer, fact } = input[locale];
    if (question.trim() && answer.trim()) {
      translations[locale] = { question, answer, fact: fact.trim() ? fact : undefined };
    }
  }
  return translations;
}

export async function createTextItem(
  formData: FormData,
  deps: ActionDeps = defaultDeps,
): Promise<ActionResult<{ id: string }>> {
  await deps.assertOperator();

  const client = createSupabaseClient(resolveLocalStackConfig());
  const input = readFormInput(formData);
  const validIds = new Set((await loadSubsubcategoryOptions(client, "nl")).map((option) => option.id));

  const errors = validateTextItem(input, validIds);
  if (errors) return fail(errors);

  const repositoryInput: TextItemInput = {
    subsubcategoryId: input.subsubcategoryId,
    difficulty: input.difficulty as Difficulty,
    translations: buildTranslations(input),
  };

  const { id } = await createTextItemRepo(client, repositoryInput);
  revalidateItemsPaths(["/admin/items"]);
  return succeed({ id });
}

export async function updateTextItem(
  id: string,
  formData: FormData,
  deps: ActionDeps = defaultDeps,
): Promise<ActionResult<{ id: string }>> {
  await deps.assertOperator();

  const client = createSupabaseClient(resolveLocalStackConfig());
  const input = readFormInput(formData);
  const validIds = new Set((await loadSubsubcategoryOptions(client, "nl")).map((option) => option.id));

  const errors = validateTextItem(input, validIds);
  if (errors) return fail(errors);

  const repositoryInput: TextItemInput = {
    subsubcategoryId: input.subsubcategoryId,
    difficulty: input.difficulty as Difficulty,
    translations: buildTranslations(input),
  };

  const result = await updateTextItemRepo(client, id, repositoryInput);
  revalidateItemsPaths(["/admin/items", `/admin/items/${id}`]);
  return succeed(result);
}
