/**
 * Pure validation for the Categories admin page (spec 4, ticket #87). No
 * Supabase import here -- server actions (actions.ts) call these and turn a
 * failure straight into fail(errors) (src/admin/forms.ts) untouched. Every
 * error value is a message key under the "categories" namespace, resolved
 * with next-intl in the page, never a literal string.
 */
import type { FieldErrors } from "@/admin/forms";
import type { Locale } from "@/domain";

export type CategoryLevel = "category" | "subcategory" | "subsubcategory";

const LEVELS: readonly CategoryLevel[] = ["category", "subcategory", "subsubcategory"];
const LOCALES: readonly Locale[] = ["nl", "en"];
const MAX_NAME_LENGTH = 120;

export interface LocaleNames {
  nl: string;
  en: string;
}

export interface AddNodeInput {
  level: unknown;
  parentId: unknown;
  nameNl: unknown;
  nameEn: unknown;
}

export interface ValidAddNode {
  level: CategoryLevel;
  /** null only for level "category" (no parent). */
  parentId: number | null;
  names: LocaleNames;
}

export interface RenameNodeInput {
  level: unknown;
  id: unknown;
  locale: unknown;
  name: unknown;
}

export interface ValidRenameNode {
  level: CategoryLevel;
  id: number;
  locale: Locale;
  name: string;
}

export interface DeleteNodeInput {
  level: unknown;
  id: unknown;
}

export interface ValidDeleteNode {
  level: CategoryLevel;
  id: number;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

function isCategoryLevel(value: unknown): value is CategoryLevel {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** A positive integer id, accepted as a number or a numeric string (form fields arrive as strings). */
function parseId(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function validateName(value: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: "categories.errors.nameRequired" };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: false, error: "categories.errors.nameRequired" };
  if (trimmed.length > MAX_NAME_LENGTH) return { ok: false, error: "categories.errors.nameTooLong" };
  return { ok: true, value: trimmed };
}

export function validateAddNode(input: AddNodeInput): ValidationResult<ValidAddNode> {
  const errors: FieldErrors = {};

  if (!isCategoryLevel(input.level)) {
    errors.level = "categories.errors.invalidLevel";
  }

  let parentId: number | null = null;
  const needsParent = input.level === "subcategory" || input.level === "subsubcategory";
  if (needsParent) {
    parentId = parseId(input.parentId);
    if (parentId === null) errors.parentId = "categories.errors.invalidParent";
  }

  const nlResult = validateName(input.nameNl);
  if (!nlResult.ok) errors.nameNl = nlResult.error;

  const enResult = validateName(input.nameEn);
  if (!enResult.ok) errors.nameEn = enResult.error;

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      level: input.level as CategoryLevel,
      parentId,
      names: { nl: (nlResult as { ok: true; value: string }).value, en: (enResult as { ok: true; value: string }).value },
    },
  };
}

export function validateRenameNode(input: RenameNodeInput): ValidationResult<ValidRenameNode> {
  const errors: FieldErrors = {};

  if (!isCategoryLevel(input.level)) errors.level = "categories.errors.invalidLevel";
  if (!isLocale(input.locale)) errors.locale = "categories.errors.invalidLocale";

  const id = parseId(input.id);
  if (id === null) errors.id = "categories.errors.invalidId";

  const nameResult = validateName(input.name);
  if (!nameResult.ok) errors.name = nameResult.error;

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      level: input.level as CategoryLevel,
      id: id as number,
      locale: input.locale as Locale,
      name: (nameResult as { ok: true; value: string }).value,
    },
  };
}

export function validateDeleteNode(input: DeleteNodeInput): ValidationResult<ValidDeleteNode> {
  const errors: FieldErrors = {};

  if (!isCategoryLevel(input.level)) errors.level = "categories.errors.invalidLevel";

  const id = parseId(input.id);
  if (id === null) errors.id = "categories.errors.invalidId";

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return { ok: true, value: { level: input.level as CategoryLevel, id: id as number } };
}
