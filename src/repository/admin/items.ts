/**
 * Admin Item reads and Text Item writes (spec 4, ticket #88). The only
 * place this ticket writes to the database -- see src/app/admin/README.md
 * (once #88 lands) and the admin-common brief "Data access". A plain
 * module of functions taking the typed Supabase client, the same shape as
 * src/repository/orders.ts.
 *
 * Text Items have no detail table (CONTEXT.md "Item storage shape"): their
 * whole payload lives in item_translations. writeItemBase/writeTranslations
 * are written to be reused as-is by the Picture and Music tickets -- only
 * the kind-specific detail-table write (picture_item_details /
 * music_item_details) is new for those tickets.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Difficulty, ItemKind, Locale } from "@/domain";
import { createSupabaseClient, type RepositoryConfig } from "../client";
import type { Database } from "../database.types";

const PAGE_SIZE = 1000;

async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
    from += PAGE_SIZE;
  }
}

interface SubsubcategoryRow {
  id: number;
  subcategory_id: number;
  subcategories: { id: number; category_id: number } | null;
}

interface ChainMaps {
  chainBySubsubcategoryId: Map<string, { subcategoryId: string; categoryId: string }>;
  categoryNameById: Map<string, string>;
  subcategoryNameById: Map<string, string>;
  subsubcategoryNameById: Map<string, string>;
}

/**
 * Every Subsubcategory's parent chain, plus every chain level's name in
 * `locale`. Shared by listItems (row display and Category/Subcategory
 * filters) and loadSubsubcategoryOptions (the create/edit form's dropdown
 * chain) -- both need the same id->name and id->parent lookups.
 */
async function loadChainMaps(client: SupabaseClient<Database>, locale: Locale): Promise<ChainMaps> {
  const [chainResult, categoryNamesResult, subcategoryNamesResult, subsubcategoryNamesResult] = await Promise.all([
    client.from("subsubcategories").select("id, subcategory_id, subcategories(id, category_id)"),
    client.from("category_translations").select("category_id, name").eq("locale", locale),
    client.from("subcategory_translations").select("subcategory_id, name").eq("locale", locale),
    client.from("subsubcategory_translations").select("subsubcategory_id, name").eq("locale", locale),
  ]);

  if (chainResult.error) throw chainResult.error;
  if (categoryNamesResult.error) throw categoryNamesResult.error;
  if (subcategoryNamesResult.error) throw subcategoryNamesResult.error;
  if (subsubcategoryNamesResult.error) throw subsubcategoryNamesResult.error;

  const chainRows = chainResult.data as SubsubcategoryRow[];
  const chainBySubsubcategoryId = new Map<string, { subcategoryId: string; categoryId: string }>();
  for (const row of chainRows) {
    if (!row.subcategories) continue;
    chainBySubsubcategoryId.set(String(row.id), {
      subcategoryId: String(row.subcategories.id),
      categoryId: String(row.subcategories.category_id),
    });
  }

  const categoryNameById = new Map<string, string>();
  for (const row of categoryNamesResult.data) categoryNameById.set(String(row.category_id), row.name);

  const subcategoryNameById = new Map<string, string>();
  for (const row of subcategoryNamesResult.data) subcategoryNameById.set(String(row.subcategory_id), row.name);

  const subsubcategoryNameById = new Map<string, string>();
  for (const row of subsubcategoryNamesResult.data) subsubcategoryNameById.set(String(row.subsubcategory_id), row.name);

  return { chainBySubsubcategoryId, categoryNameById, subcategoryNameById, subsubcategoryNameById };
}

export interface SubsubcategoryOption {
  id: string;
  /** "Category / Subcategory / Subsubcategory", names in the requested Locale. */
  path: string;
}

/**
 * Every Subsubcategory as a dropdown option for the Text Item form, with
 * its full chain spelled out (a bare Subsubcategory name is ambiguous --
 * the same name can recur under different parents). Ticket #88 writes its
 * own small read rather than importing #87's categories.ts (parallel
 * tickets, see the ticket brief).
 */
export async function loadSubsubcategoryOptions(
  client: SupabaseClient<Database>,
  locale: Locale,
): Promise<SubsubcategoryOption[]> {
  const { chainBySubsubcategoryId, categoryNameById, subcategoryNameById, subsubcategoryNameById } =
    await loadChainMaps(client, locale);

  const options: SubsubcategoryOption[] = [];
  for (const [subsubcategoryId, chain] of chainBySubsubcategoryId) {
    const categoryName = categoryNameById.get(chain.categoryId) ?? "";
    const subcategoryName = subcategoryNameById.get(chain.subcategoryId) ?? "";
    const subsubcategoryName = subsubcategoryNameById.get(subsubcategoryId) ?? "";
    options.push({
      id: subsubcategoryId,
      path: `${categoryName} / ${subcategoryName} / ${subsubcategoryName}`,
    });
  }

  options.sort((a, b) => a.path.localeCompare(b.path));
  return options;
}

export interface ListItemsFilters {
  locale: Locale;
  query?: string;
  kind?: ItemKind;
  categoryId?: string;
  subcategoryId?: string;
  subsubcategoryId?: string;
  difficulty?: Difficulty;
  /** Show only Items missing a translation for this Locale. */
  missingLocale?: Locale;
  /** Include archived Items (marked in the row); default false shows only live Items. */
  includeArchived?: boolean;
  page: number;
  pageSize: number;
}

export interface ItemListRow {
  id: string;
  kind: ItemKind;
  difficulty: Difficulty;
  categoryName: string;
  subcategoryName: string;
  subsubcategoryName: string;
  /** This row's translation for `filters.locale`; null when that Locale has no translation. */
  question: string | null;
  answer: string | null;
  /** Every Locale this Item has a translation for. */
  locales: Locale[];
  archivedAt: string | null;
}

export interface ListItemsResult {
  items: ItemListRow[];
  total: number;
}

interface ItemBaseRow {
  id: string;
  kind: ItemKind;
  difficulty: Difficulty;
  subsubcategory_id: number;
  archived_at: string | null;
  created_at: string;
  item_translations: { locale: Locale; question: string | null; answer: string | null }[];
}

/**
 * Lists Items with the operator's filters and search, paginated. Fetches
 * every Item matching the DB-cheap filters (kind, Difficulty, Category
 * chain, archived) in one pass -- comfortably within PostgREST's page cap
 * even unfiltered (2640 seed Items, src/repository/pool.ts's own comment)
 * -- then applies search and the missing-Translation filter in memory,
 * since both need per-row translation-set logic PostgREST's embedded
 * filters can't express in one query.
 */
export async function listItems(
  client: SupabaseClient<Database>,
  filters: ListItemsFilters,
): Promise<ListItemsResult> {
  const { chainBySubsubcategoryId, categoryNameById, subcategoryNameById, subsubcategoryNameById } =
    await loadChainMaps(client, filters.locale);

  let allowedSubsubcategoryIds: Set<string> | null = null;
  if (filters.subsubcategoryId || filters.subcategoryId || filters.categoryId) {
    allowedSubsubcategoryIds = new Set();
    for (const [subsubcategoryId, chain] of chainBySubsubcategoryId) {
      if (filters.subsubcategoryId && subsubcategoryId !== filters.subsubcategoryId) continue;
      if (filters.subcategoryId && chain.subcategoryId !== filters.subcategoryId) continue;
      if (filters.categoryId && chain.categoryId !== filters.categoryId) continue;
      allowedSubsubcategoryIds.add(subsubcategoryId);
    }
  }

  // A fresh builder per page (not one builder object reused across
  // `.range()` calls, which PostgREST's chainable builder mutates in
  // place) -- same pattern as src/repository/pool.ts's fetchAllPages use.
  function buildQuery(from: number, to: number) {
    let query = client
      .from("items")
      .select("id, kind, difficulty, subsubcategory_id, archived_at, created_at, item_translations(locale,question,answer)");

    if (filters.kind) query = query.eq("kind", filters.kind);
    if (filters.difficulty) query = query.eq("difficulty", filters.difficulty);
    if (!filters.includeArchived) query = query.is("archived_at", null);
    if (allowedSubsubcategoryIds) {
      query = query.in(
        "subsubcategory_id",
        [...allowedSubsubcategoryIds].map((id) => Number(id)),
      );
    }
    return query.order("created_at", { ascending: false }).range(from, to);
  }

  const rows = (await fetchAllPages<ItemBaseRow>((from, to) => buildQuery(from, to))) as ItemBaseRow[];

  const trimmedQuery = filters.query?.trim().toLowerCase();

  const filtered = rows.filter((row) => {
    if (filters.missingLocale) {
      const hasMissingLocale = row.item_translations.some((t) => t.locale === filters.missingLocale);
      if (hasMissingLocale) return false;
    }
    if (trimmedQuery) {
      const translation = row.item_translations.find((t) => t.locale === filters.locale);
      const question = (translation?.question ?? "").toLowerCase();
      const answer = (translation?.answer ?? "").toLowerCase();
      if (!question.includes(trimmedQuery) && !answer.includes(trimmedQuery)) return false;
    }
    return true;
  });

  const start = (filters.page - 1) * filters.pageSize;
  const page = filtered.slice(start, start + filters.pageSize);

  const items: ItemListRow[] = page.map((row) => {
    const chain = chainBySubsubcategoryId.get(String(row.subsubcategory_id));
    const translation = row.item_translations.find((t) => t.locale === filters.locale);
    return {
      id: row.id,
      kind: row.kind,
      difficulty: row.difficulty,
      categoryName: chain ? (categoryNameById.get(chain.categoryId) ?? "") : "",
      subcategoryName: chain ? (subcategoryNameById.get(chain.subcategoryId) ?? "") : "",
      subsubcategoryName: subsubcategoryNameById.get(String(row.subsubcategory_id)) ?? "",
      question: translation?.question ?? null,
      answer: translation?.answer ?? null,
      locales: row.item_translations.map((t) => t.locale),
      archivedAt: row.archived_at,
    };
  });

  return { items, total: filtered.length };
}

export interface ItemTranslationInput {
  question: string;
  answer: string;
  fact?: string;
}

export interface TextItemTranslations {
  nl?: ItemTranslationInput;
  en?: ItemTranslationInput;
}

export interface ItemDetail {
  id: string;
  kind: ItemKind;
  difficulty: Difficulty;
  subsubcategoryId: string;
  archivedAt: string | null;
  translations: Partial<Record<Locale, { question: string; answer: string; fact: string | null }>>;
}

/** One Item with both Locale translations and its detail row (detail row is a later ticket's concern for Picture/Music). */
export async function getItem(client: SupabaseClient<Database>, id: string): Promise<ItemDetail | null> {
  const { data, error } = await client
    .from("items")
    .select("id, kind, difficulty, subsubcategory_id, archived_at, item_translations(locale,question,answer,fact)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const translations: ItemDetail["translations"] = {};
  for (const row of data.item_translations) {
    translations[row.locale] = { question: row.question ?? "", answer: row.answer ?? "", fact: row.fact };
  }

  return {
    id: data.id,
    kind: data.kind,
    difficulty: data.difficulty,
    subsubcategoryId: String(data.subsubcategory_id),
    archivedAt: data.archived_at,
    translations,
  };
}

interface ItemBaseInput {
  kind: ItemKind;
  subsubcategoryId: string;
  difficulty: Difficulty;
}

/**
 * Writes the shared `items` base row: inserts when `id` is null, otherwise
 * updates the mutable fields (Subsubcategory, Difficulty) of an existing
 * Item -- `kind` is fixed once an Item is created, so an update never
 * touches it. Shared by createTextItem/updateTextItem and, later, the
 * Picture and Music tickets' own create/update functions.
 */
export async function writeItemBase(
  client: SupabaseClient<Database>,
  id: string | null,
  input: ItemBaseInput,
): Promise<string> {
  if (id) {
    const { error } = await client
      .from("items")
      .update({ subsubcategory_id: Number(input.subsubcategoryId), difficulty: input.difficulty })
      .eq("id", id);
    if (error) throw error;
    return id;
  }

  const { data, error } = await client
    .from("items")
    .insert({ kind: input.kind, subsubcategory_id: Number(input.subsubcategoryId), difficulty: input.difficulty })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/**
 * Upserts a translation row per given, complete Locale and deletes the row
 * for any Locale omitted or left entirely empty (validate.ts already
 * refused a half-filled Locale before this runs, so "given" here always
 * means complete). Shared by createTextItem/updateTextItem and, later, the
 * Picture and Music tickets (their translations carry answer/fact only,
 * question stays null for those kinds -- CONTEXT.md "Item storage shape").
 */
export async function writeTranslations(
  client: SupabaseClient<Database>,
  itemId: string,
  translations: TextItemTranslations,
): Promise<void> {
  for (const locale of ["nl", "en"] as const) {
    const translation = translations[locale];
    if (translation) {
      const { error } = await client
        .from("item_translations")
        .upsert(
          { item_id: itemId, locale, question: translation.question, answer: translation.answer, fact: translation.fact ?? null },
          { onConflict: "item_id,locale" },
        );
      if (error) throw error;
    } else {
      const { error } = await client.from("item_translations").delete().eq("item_id", itemId).eq("locale", locale);
      if (error) throw error;
    }
  }
}

export interface TextItemInput {
  subsubcategoryId: string;
  difficulty: Difficulty;
  translations: TextItemTranslations;
}

export async function createTextItem(
  client: SupabaseClient<Database>,
  input: TextItemInput,
): Promise<{ id: string }> {
  const id = await writeItemBase(client, null, {
    kind: "text",
    subsubcategoryId: input.subsubcategoryId,
    difficulty: input.difficulty,
  });
  await writeTranslations(client, id, input.translations);
  return { id };
}

export async function updateTextItem(
  client: SupabaseClient<Database>,
  id: string,
  input: TextItemInput,
): Promise<{ id: string }> {
  await writeItemBase(client, id, { kind: "text", subsubcategoryId: input.subsubcategoryId, difficulty: input.difficulty });
  await writeTranslations(client, id, input.translations);
  return { id };
}

export interface ItemsAdminRepository {
  loadSubsubcategoryOptions(locale: Locale): Promise<SubsubcategoryOption[]>;
  listItems(filters: ListItemsFilters): Promise<ListItemsResult>;
  getItem(id: string): Promise<ItemDetail | null>;
  createTextItem(input: TextItemInput): Promise<{ id: string }>;
  updateTextItem(id: string, input: TextItemInput): Promise<{ id: string }>;
}

export function createItemsAdminRepository(config: RepositoryConfig): ItemsAdminRepository {
  const client = createSupabaseClient(config);
  return {
    loadSubsubcategoryOptions: (locale) => loadSubsubcategoryOptions(client, locale),
    listItems: (filters) => listItems(client, filters),
    getItem: (id) => getItem(client, id),
    createTextItem: (input) => createTextItem(client, input),
    updateTextItem: (id, input) => updateTextItem(client, id, input),
  };
}
