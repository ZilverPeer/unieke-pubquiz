"use server";
/**
 * Picture Item create/edit server actions (spec 4, ticket #90). Same
 * `ActionDeps` seam as ./actions.ts (the type is imported from there,
 * items-kind-common brief): assertOperator is re-checked here rather than
 * trusted from the page render, and revalidateItems/assertOperator are
 * both injectable so the integration suite can bypass the real Supabase
 * Auth session and the revalidatePath() call that only works inside a real
 * Next.js request.
 *
 * defaultRevalidateItems is a local copy of ./actions.ts's own private
 * helper, not an import: a "use server" file may only export async
 * functions (Server Actions), so that helper cannot be exported from
 * ./actions.ts for reuse here.
 */
import { revalidatePath } from "next/cache";
import { assertOperator } from "@/admin/auth/session";
import { type ActionResult, fail, succeed } from "@/admin/forms";
import { type PictureItemFormInput, validatePictureItem } from "@/admin/items/validate-picture";
import type { Difficulty } from "@/domain";
import { createSupabaseClient, resolveLocalStackConfig } from "@/repository";
import { loadSubsubcategoryOptions } from "@/repository/admin/items";
import {
  createPictureItem as createPictureItemRepo,
  PictureNotAnImageError,
  updatePictureItem as updatePictureItemRepo,
  type PictureItemTranslations,
} from "@/repository/admin/picture-items";
import type { ActionDeps } from "./actions";

function defaultRevalidateItems(id?: string): void {
  revalidatePath("/admin/items");
  if (id) revalidatePath(`/admin/items/${id}`);
}

const defaultDeps: ActionDeps = { assertOperator, revalidateItems: defaultRevalidateItems };

function readLocaleInput(formData: FormData, locale: "nl" | "en"): { answer: string; fact: string } {
  return {
    answer: String(formData.get(`${locale}.answer`) ?? ""),
    fact: String(formData.get(`${locale}.fact`) ?? ""),
  };
}

function readFormInput(formData: FormData, file: File | null, fileRequired: boolean): PictureItemFormInput {
  return {
    subsubcategoryId: String(formData.get("subsubcategoryId") ?? ""),
    difficulty: String(formData.get("difficulty") ?? ""),
    nl: readLocaleInput(formData, "nl"),
    en: readLocaleInput(formData, "en"),
    file: file ? { type: file.type, size: file.size } : null,
    fileRequired,
  };
}

function buildTranslations(input: PictureItemFormInput): PictureItemTranslations {
  const translations: PictureItemTranslations = {};
  for (const locale of ["nl", "en"] as const) {
    const { answer, fact } = input[locale];
    if (answer.trim()) {
      translations[locale] = { answer, fact: fact.trim() ? fact : undefined };
    }
  }
  return translations;
}

/**
 * Reads the uploaded `File` from `formData.get("file")` -- `null` when no
 * file field is present, or an empty file input was submitted (a File of
 * size 0, which readFormInput/validatePictureItem then reject the same way
 * as no file, since an empty upload is never a valid image either).
 */
function readFile(formData: FormData): File | null {
  const value = formData.get("file");
  if (!(value instanceof File) || value.size === 0) return null;
  return value;
}

export async function createPictureItem(
  formData: FormData,
  deps: ActionDeps = defaultDeps,
): Promise<ActionResult<{ id: string }>> {
  await deps.assertOperator();

  const client = createSupabaseClient(resolveLocalStackConfig());
  const file = readFile(formData);
  const input = readFormInput(formData, file, true);
  const validIds = new Set((await loadSubsubcategoryOptions(client, "nl")).map((option) => option.id));

  const errors = validatePictureItem(input, validIds);
  if (errors) return fail(errors);

  try {
    const { id } = await createPictureItemRepo(client, {
      subsubcategoryId: input.subsubcategoryId,
      difficulty: input.difficulty as Difficulty,
      translations: buildTranslations(input),
      image: Buffer.from(await file!.arrayBuffer()),
    });
    deps.revalidateItems();
    return succeed({ id });
  } catch (err) {
    if (err instanceof PictureNotAnImageError) return fail({ file: "pictureItems.errors.file.notImage" });
    throw err;
  }
}

export async function updatePictureItem(
  id: string,
  formData: FormData,
  deps: ActionDeps = defaultDeps,
): Promise<ActionResult<{ id: string }>> {
  await deps.assertOperator();

  const client = createSupabaseClient(resolveLocalStackConfig());
  const file = readFile(formData);
  const input = readFormInput(formData, file, false);
  const validIds = new Set((await loadSubsubcategoryOptions(client, "nl")).map((option) => option.id));

  const errors = validatePictureItem(input, validIds);
  if (errors) return fail(errors);

  try {
    const result = await updatePictureItemRepo(client, id, {
      subsubcategoryId: input.subsubcategoryId,
      difficulty: input.difficulty as Difficulty,
      translations: buildTranslations(input),
      image: file ? Buffer.from(await file.arrayBuffer()) : undefined,
    });
    deps.revalidateItems(id);
    return succeed(result);
  } catch (err) {
    if (err instanceof PictureNotAnImageError) return fail({ file: "pictureItems.errors.file.notImage" });
    throw err;
  }
}
