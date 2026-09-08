"use server";
/**
 * Server actions for the Categories admin page (spec 4, ticket #87). Each
 * action re-checks the operator through assertOperator() (src/admin/auth/session.ts)
 * rather than trusting the page's own guard -- a direct POST bypasses the
 * layout. The check is injectable (deps.assertOperator) so
 * actions.integration.test.ts can call these directly without a real
 * cookie/session, per admin-common.md's brief for this ticket wave.
 *
 * Every write goes through src/repository/admin/categories.ts, the only
 * writer of the Category tables from the admin UI (see that file's docblock
 * and src/repository/README.md "Admin: categories").
 */
import { revalidatePath } from "next/cache";
import { fail, succeed, type ActionResult } from "@/admin/forms";
import { assertOperator as assertOperatorImpl, type OperatorSession } from "@/admin/auth/session";
import {
  validateAddNode,
  validateDeleteNode,
  validateRenameNode,
  type CategoryLevel,
} from "@/admin/categories/validate";
import {
  createCategoriesAdminRepository,
  type CategoriesAdminRepository,
} from "@/repository/admin/categories";
import { resolveLocalStackConfig } from "@/repository";

export interface ActionDeps {
  assertOperator: () => Promise<OperatorSession>;
  repository: CategoriesAdminRepository;
  /**
   * Defaults to next/cache's revalidatePath. Injectable because it throws
   * ("static generation store missing") outside a real Next.js request --
   * actions.integration.test.ts calls these actions directly under vitest,
   * with no such request, and stubs this to a no-op.
   */
  revalidateCategories: () => void;
}

function defaultRepository(): CategoriesAdminRepository {
  return createCategoriesAdminRepository(resolveLocalStackConfig());
}

function defaultRevalidateCategories(): void {
  revalidatePath("/admin/categories");
}

const defaultDeps: ActionDeps = {
  assertOperator: assertOperatorImpl,
  get repository() {
    return defaultRepository();
  },
  revalidateCategories: defaultRevalidateCategories,
};

function formValue(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" ? value : null;
}

export async function addNode(formData: FormData, deps: ActionDeps = defaultDeps): Promise<ActionResult<{ id: number }>> {
  await deps.assertOperator();

  const validated = validateAddNode({
    level: formValue(formData, "level"),
    parentId: formValue(formData, "parentId"),
    nameNl: formValue(formData, "nameNl"),
    nameEn: formValue(formData, "nameEn"),
  });
  if (!validated.ok) return fail(validated.errors);

  const { level, parentId, names } = validated.value;
  let result: { id: number };
  if (level === "category") {
    result = await deps.repository.createCategory({ names });
  } else if (level === "subcategory") {
    result = await deps.repository.createSubcategory({ parentId: parentId as number, names });
  } else {
    result = await deps.repository.createSubsubcategory({ parentId: parentId as number, names });
  }

  deps.revalidateCategories();
  return succeed(result);
}

export async function renameNode(formData: FormData, deps: ActionDeps = defaultDeps): Promise<ActionResult<void>> {
  await deps.assertOperator();

  const validated = validateRenameNode({
    level: formValue(formData, "level"),
    id: formValue(formData, "id"),
    locale: formValue(formData, "locale"),
    name: formValue(formData, "name"),
  });
  if (!validated.ok) return fail(validated.errors);

  await deps.repository.renameNode(validated.value);
  deps.revalidateCategories();
  return succeed(undefined);
}

// Not a form-validation failure (the input -- level/id -- was well-formed),
// so this is ActionResult's ok:true branch, not fail(): the delete was
// refused as a business rule outcome, and the refusal message needs a
// {count} interpolation parameter next-intl's getTranslations resolves in
// the page, which a plain FieldErrors message-key string can't carry.
export type DeleteNodeValue =
  | { deleted: true }
  | { deleted: false; reason: "has-children" | "has-items"; count: number };

export async function deleteNode(
  formData: FormData,
  deps: ActionDeps = defaultDeps,
): Promise<ActionResult<DeleteNodeValue>> {
  await deps.assertOperator();

  const validated = validateDeleteNode({
    level: formValue(formData, "level"),
    id: formValue(formData, "id"),
  });
  if (!validated.ok) return fail(validated.errors);

  const result = await deps.repository.deleteNode(validated.value);
  if (!result.ok) {
    return succeed({ deleted: false, reason: result.reason, count: result.count });
  }

  deps.revalidateCategories();
  return succeed({ deleted: true });
}

export type { CategoryLevel };
