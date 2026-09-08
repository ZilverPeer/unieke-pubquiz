/**
 * Categories admin repository (spec 4, ticket #87): the only place the
 * Categories admin page writes Category/Subcategory/Subsubcategory rows and
 * their per-Locale translations. Sibling of the existing repository
 * factories (see src/repository/README.md "Admin: categories") -- never
 * folded into ContentRepository, and never imported by src/sample,
 * src/render or src/deliver.
 *
 * Schema (supabase/migrations/00002_categories.sql): each level's table
 * cascade-deletes its translations and, for categories/subcategories, its
 * children on delete -- that cascade is exactly what the guarded delete
 * below must never trigger while a child (or, for a Subsubcategory, an
 * Item) still references the node. items.subsubcategory_id has no cascade
 * (plain restrict), so a Subsubcategory delete while Items reference it
 * fails at the database if the application check were ever skipped; the
 * Category/Subcategory cascades have no such backstop, so those two levels
 * are guarded purely in application code here.
 *
 * deleteNode's guard is two statements, not one atomic statement or
 * transaction: a `select(..., { count: "exact", head: true })` to read the
 * blocking count, then a delete only when that count is zero. A single
 * `delete ... where not exists (...)` would need either a raw SQL
 * connection or a database function, and this ticket's brief keeps
 * `supabase/migrations` untouched (no schema change) -- see the ticket #87
 * PR body for this documented as an accepted small race window (two
 * operators, or the operator and a bulk import from a later ticket, adding
 * a child between the count read and the delete), acceptable for a
 * single-operator admin tool.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Locale } from "@/domain";
import { createSupabaseClient, type RepositoryConfig } from "../client";
import type { Database } from "../database.types";

export type CategoryLevel = "category" | "subcategory" | "subsubcategory";

export interface LocaleNames {
  nl: string;
  en: string;
}

export interface SubsubcategoryNode {
  id: number;
  names: LocaleNames;
}

export interface SubcategoryNode {
  id: number;
  names: LocaleNames;
  subsubcategories: SubsubcategoryNode[];
}

export interface CategoryNode {
  id: number;
  names: LocaleNames;
  subcategories: SubcategoryNode[];
}

export interface CreateNodeInput {
  names: LocaleNames;
}

export interface CreateChildNodeInput extends CreateNodeInput {
  parentId: number;
}

export interface RenameNodeInput {
  level: CategoryLevel;
  id: number;
  locale: Locale;
  name: string;
}

export interface DeleteNodeInput {
  level: CategoryLevel;
  id: number;
}

export type DeleteNodeResult =
  | { ok: true }
  | { ok: false; reason: "has-children" | "has-items"; count: number };

function emptyNames(): LocaleNames {
  return { nl: "", en: "" };
}

function applyTranslationRows(target: LocaleNames, rows: { locale: Locale; name: string }[]): void {
  for (const row of rows) {
    if (row.locale === "nl") target.nl = row.name;
    else target.en = row.name;
  }
}

export async function loadCategoryTree(client: SupabaseClient<Database>): Promise<CategoryNode[]> {
  const [
    categoriesResult,
    categoryTranslationsResult,
    subcategoriesResult,
    subcategoryTranslationsResult,
    subsubcategoriesResult,
    subsubcategoryTranslationsResult,
  ] = await Promise.all([
    client.from("categories").select("id").order("id"),
    client.from("category_translations").select("category_id, locale, name"),
    client.from("subcategories").select("id, category_id").order("id"),
    client.from("subcategory_translations").select("subcategory_id, locale, name"),
    client.from("subsubcategories").select("id, subcategory_id").order("id"),
    client.from("subsubcategory_translations").select("subsubcategory_id, locale, name"),
  ]);

  for (const result of [
    categoriesResult,
    categoryTranslationsResult,
    subcategoriesResult,
    subcategoryTranslationsResult,
    subsubcategoriesResult,
    subsubcategoryTranslationsResult,
  ]) {
    if (result.error) throw result.error;
  }

  const subsubNamesById = new Map<number, LocaleNames>();
  for (const row of subsubcategoriesResult.data ?? []) {
    subsubNamesById.set(row.id, emptyNames());
  }
  for (const row of subsubcategoryTranslationsResult.data ?? []) {
    const names = subsubNamesById.get(row.subsubcategory_id);
    if (names) applyTranslationRows(names, [row]);
  }

  const subsubsBySubcategoryId = new Map<number, SubsubcategoryNode[]>();
  for (const row of subsubcategoriesResult.data ?? []) {
    const list = subsubsBySubcategoryId.get(row.subcategory_id) ?? [];
    list.push({ id: row.id, names: subsubNamesById.get(row.id) ?? emptyNames() });
    subsubsBySubcategoryId.set(row.subcategory_id, list);
  }

  const subcategoryNamesById = new Map<number, LocaleNames>();
  for (const row of subcategoriesResult.data ?? []) {
    subcategoryNamesById.set(row.id, emptyNames());
  }
  for (const row of subcategoryTranslationsResult.data ?? []) {
    const names = subcategoryNamesById.get(row.subcategory_id);
    if (names) applyTranslationRows(names, [row]);
  }

  const subcategoriesByCategoryId = new Map<number, SubcategoryNode[]>();
  for (const row of subcategoriesResult.data ?? []) {
    const list = subcategoriesByCategoryId.get(row.category_id) ?? [];
    list.push({
      id: row.id,
      names: subcategoryNamesById.get(row.id) ?? emptyNames(),
      subsubcategories: subsubsBySubcategoryId.get(row.id) ?? [],
    });
    subcategoriesByCategoryId.set(row.category_id, list);
  }

  const categoryNamesById = new Map<number, LocaleNames>();
  for (const row of categoriesResult.data ?? []) {
    categoryNamesById.set(row.id, emptyNames());
  }
  for (const row of categoryTranslationsResult.data ?? []) {
    const names = categoryNamesById.get(row.category_id);
    if (names) applyTranslationRows(names, [row]);
  }

  return (categoriesResult.data ?? []).map((row) => ({
    id: row.id,
    names: categoryNamesById.get(row.id) ?? emptyNames(),
    subcategories: subcategoriesByCategoryId.get(row.id) ?? [],
  }));
}

async function insertTranslations(
  client: SupabaseClient<Database>,
  table: "category_translations" | "subcategory_translations" | "subsubcategory_translations",
  idColumn: "category_id" | "subcategory_id" | "subsubcategory_id",
  id: number,
  names: LocaleNames,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (client.from(table) as any).insert([
    { [idColumn]: id, locale: "nl", name: names.nl },
    { [idColumn]: id, locale: "en", name: names.en },
  ]);
  if (error) throw error;
}

export async function createCategory(client: SupabaseClient<Database>, input: CreateNodeInput): Promise<{ id: number }> {
  const { data, error } = await client.from("categories").insert({}).select("id").single();
  if (error) throw error;
  await insertTranslations(client, "category_translations", "category_id", data.id, input.names);
  return { id: data.id };
}

export async function createSubcategory(
  client: SupabaseClient<Database>,
  input: CreateChildNodeInput,
): Promise<{ id: number }> {
  const { data, error } = await client
    .from("subcategories")
    .insert({ category_id: input.parentId })
    .select("id")
    .single();
  if (error) throw error;
  await insertTranslations(client, "subcategory_translations", "subcategory_id", data.id, input.names);
  return { id: data.id };
}

export async function createSubsubcategory(
  client: SupabaseClient<Database>,
  input: CreateChildNodeInput,
): Promise<{ id: number }> {
  const { data, error } = await client
    .from("subsubcategories")
    .insert({ subcategory_id: input.parentId })
    .select("id")
    .single();
  if (error) throw error;
  await insertTranslations(client, "subsubcategory_translations", "subsubcategory_id", data.id, input.names);
  return { id: data.id };
}

export async function renameNode(client: SupabaseClient<Database>, input: RenameNodeInput): Promise<void> {
  const tableByLevel = {
    category: { table: "category_translations", idColumn: "category_id" },
    subcategory: { table: "subcategory_translations", idColumn: "subcategory_id" },
    subsubcategory: { table: "subsubcategory_translations", idColumn: "subsubcategory_id" },
  } as const;
  const { table, idColumn } = tableByLevel[input.level];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (client.from(table) as any)
    .update({ name: input.name })
    .eq(idColumn, input.id)
    .eq("locale", input.locale);
  if (error) throw error;
}

export async function deleteNode(client: SupabaseClient<Database>, input: DeleteNodeInput): Promise<DeleteNodeResult> {
  if (input.level === "category") {
    const { count, error } = await client
      .from("subcategories")
      .select("id", { count: "exact", head: true })
      .eq("category_id", input.id);
    if (error) throw error;
    if ((count ?? 0) > 0) return { ok: false, reason: "has-children", count: count ?? 0 };

    const { error: deleteError } = await client.from("categories").delete().eq("id", input.id);
    if (deleteError) throw deleteError;
    return { ok: true };
  }

  if (input.level === "subcategory") {
    const { count, error } = await client
      .from("subsubcategories")
      .select("id", { count: "exact", head: true })
      .eq("subcategory_id", input.id);
    if (error) throw error;
    if ((count ?? 0) > 0) return { ok: false, reason: "has-children", count: count ?? 0 };

    const { error: deleteError } = await client.from("subcategories").delete().eq("id", input.id);
    if (deleteError) throw deleteError;
    return { ok: true };
  }

  const { count, error } = await client
    .from("items")
    .select("id", { count: "exact", head: true })
    .eq("subsubcategory_id", input.id);
  if (error) throw error;
  if ((count ?? 0) > 0) return { ok: false, reason: "has-items", count: count ?? 0 };

  const { error: deleteError } = await client.from("subsubcategories").delete().eq("id", input.id);
  if (deleteError) throw deleteError;
  return { ok: true };
}

export interface CategoriesAdminRepository {
  loadCategoryTree(): Promise<CategoryNode[]>;
  createCategory(input: CreateNodeInput): Promise<{ id: number }>;
  createSubcategory(input: CreateChildNodeInput): Promise<{ id: number }>;
  createSubsubcategory(input: CreateChildNodeInput): Promise<{ id: number }>;
  renameNode(input: RenameNodeInput): Promise<void>;
  deleteNode(input: DeleteNodeInput): Promise<DeleteNodeResult>;
}

export function createCategoriesAdminRepository(config: RepositoryConfig): CategoriesAdminRepository {
  const client = createSupabaseClient(config);

  return {
    loadCategoryTree: () => loadCategoryTree(client),
    createCategory: (input) => createCategory(client, input),
    createSubcategory: (input) => createSubcategory(client, input),
    createSubsubcategory: (input) => createSubsubcategory(client, input),
    renameNode: (input) => renameNode(client, input),
    deleteNode: (input) => deleteNode(client, input),
  };
}
