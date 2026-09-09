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
  archiveItem as archiveItemRepo,
  createTextItem as createTextItemRepo,
  deleteItem as deleteItemRepo,
  ItemInUseError,
  loadSubsubcategoryOptions,
  unarchiveItem as unarchiveItemRepo,
  updateTextItem as updateTextItemRepo,
  type TextItemInput,
  type TextItemTranslations,
} from "@/repository/admin/items";

export interface ActionDeps {
  assertOperator: typeof assertOperator;
  /**
   * Defaults to next/cache's revalidatePath. Injectable (same shape as
   * ticket #87's deps.revalidateCategories) because revalidatePath()
   * throws ("static generation store missing") outside a real Next.js
   * request -- actions.integration.test.ts calls these actions directly
   * under vitest, with no such request, and stubs this to a no-op.
   */
  revalidateItems: (id?: string) => void;
}

function defaultRevalidateItems(id?: string): void {
  revalidatePath("/admin/items");
  if (id) revalidatePath(`/admin/items/${id}`);
}

const defaultDeps: ActionDeps = { assertOperator, revalidateItems: defaultRevalidateItems };

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
  deps.revalidateItems();
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
  deps.revalidateItems(id);
  return succeed(result);
}

/**
 * Archive/unarchive/delete (ticket #89). Additive, same `deps` seam as
 * createTextItem/updateTextItem above: each re-checks the operator and
 * revalidates the list and edit pages. Archive and unarchive are always
 * allowed (an Item stays in the no-repeat history regardless of usage);
 * delete is refused when the Item is used, which the repository's single
 * delete statement enforces race-safe through the composition_items foreign
 * key (src/repository/admin/items.ts's deleteItem docblock) -- this action
 * just maps that refusal to the itemLifecycle.errors.inUse message key.
 */
export async function archiveItem(id: string, deps: ActionDeps = defaultDeps): Promise<ActionResult<{ id: string }>> {
  await deps.assertOperator();

  const client = createSupabaseClient(resolveLocalStackConfig());
  await archiveItemRepo(client, id);
  deps.revalidateItems(id);
  return succeed({ id });
}

export async function unarchiveItem(id: string, deps: ActionDeps = defaultDeps): Promise<ActionResult<{ id: string }>> {
  await deps.assertOperator();

  const client = createSupabaseClient(resolveLocalStackConfig());
  await unarchiveItemRepo(client, id);
  deps.revalidateItems(id);
  return succeed({ id });
}

export async function deleteItem(id: string, deps: ActionDeps = defaultDeps): Promise<ActionResult<{ id: string }>> {
  await deps.assertOperator();

  const client = createSupabaseClient(resolveLocalStackConfig());
  try {
    await deleteItemRepo(client, id);
  } catch (error) {
    if (error instanceof ItemInUseError) {
      return fail({ item: "itemLifecycle.errors.inUse" });
    }
    throw error;
  }

  deps.revalidateItems(id);
  return succeed({ id });
}
