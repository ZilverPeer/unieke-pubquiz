/**
 * loadPool: Items joined to their translation for the requested Locale and
 * to their Category chain, plus detail data (picture/music) later renderers
 * need. Private helper for src/repository/index.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Difficulty, ItemKind, Locale, PoolItem } from "@/domain";
import type { Database } from "./database.types";
import type { ItemTranslation, PoolEntry } from "./types";

// PostgREST embedded-select strings are only shallowly typed by supabase-js's
// generic client; the nested joins below (items -> item_translations,
// items -> picture/music details) go deeper than that inference handles well,
// so this one query is read through a locally-declared shape instead of the
// generated Database types.
interface ItemRow {
  id: string;
  kind: ItemKind;
  difficulty: Difficulty;
  subsubcategory_id: number;
  item_translations: { question: string | null; answer: string | null; fact: string | null }[];
  picture_item_details: { storage_path: string } | null;
  music_item_details: { storage_path: string; artist: string; title: string } | null;
}

interface SubsubcategoryRow {
  id: number;
  subcategory_id: number;
  subcategories: { id: number; category_id: number } | null;
}

// Locale is a two-value enum (nl | en); "the other Locale" is well-defined.
function otherLocale(locale: Locale): Locale {
  return locale === "nl" ? "en" : "nl";
}

// PostgREST caps any single response at config.toml's api.max_rows (1000
// locally). Both queries below scale with the Item count (currently 717 per
// Locale, comfortably under that cap, but nothing stops the pool from
// growing past it) -- paginate in pages of PAGE_SIZE, following a stable
// `id` order, until a short page proves there's no more data, rather than
// silently returning a truncated pool once the Item count crosses 1000.
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

export async function loadPool(
  client: SupabaseClient<Database>,
  locale: Locale,
): Promise<PoolEntry[]> {
  const other = otherLocale(locale);
  const [itemRows, chainResult, categoryNamesResult, otherLocaleRows] = await Promise.all([
    fetchAllPages<ItemRow>((from, to) =>
      // See the comment on ItemRow above: this embedded select goes deeper
      // than supabase-js's generic select-string inference handles.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client.from("items") as any)
        .select(
          `
            id,
            kind,
            difficulty,
            subsubcategory_id,
            item_translations!inner(question,answer,fact),
            picture_item_details(storage_path),
            music_item_details(storage_path,artist,title)
          `,
        )
        .eq("item_translations.locale", locale)
        .order("id")
        .range(from, to),
    ),
    client.from("subsubcategories").select("id, subcategory_id, subcategories(id, category_id)"),
    client.from("category_translations").select("category_id, name").eq("locale", locale),
    // Filtering to just the *other* Locale (rather than every translation row
    // for every Locale, or passing the whole pool's ids in an `.in()`
    // filter, which blows the URL length limit at this pool size) keeps the
    // row count per page at most the total Item count, paginated the same
    // way as the main Items query above.
    fetchAllPages<{ item_id: string }>((from, to) =>
      client.from("item_translations").select("item_id").eq("locale", other).order("item_id").range(from, to),
    ),
  ]);

  if (chainResult.error) throw chainResult.error;
  if (categoryNamesResult.error) throw categoryNamesResult.error;

  const hasOtherLocale = new Set(otherLocaleRows.map((row) => row.item_id));

  const chainRows = chainResult.data as SubsubcategoryRow[];
  const chainBySubsubcategoryId = new Map<
    string,
    { subcategoryId: string; categoryId: string }
  >();
  for (const row of chainRows) {
    if (!row.subcategories) continue;
    chainBySubsubcategoryId.set(String(row.id), {
      subcategoryId: String(row.subcategories.id),
      categoryId: String(row.subcategories.category_id),
    });
  }

  const categoryNameById = new Map<string, string>();
  for (const row of categoryNamesResult.data) {
    categoryNameById.set(String(row.category_id), row.name);
  }

  const entries: PoolEntry[] = [];

  for (const row of itemRows) {
    const chain = chainBySubsubcategoryId.get(String(row.subsubcategory_id));
    if (!chain) continue;

    const translationRow = row.item_translations[0];
    const translation: ItemTranslation = {
      question: translationRow?.question ?? null,
      answer: translationRow?.answer ?? null,
      fact: translationRow?.fact ?? null,
    };

    const item: PoolItem = {
      id: row.id,
      kind: row.kind,
      difficulty: row.difficulty,
      categoryId: chain.categoryId,
      subcategoryId: chain.subcategoryId,
      subsubcategoryId: String(row.subsubcategory_id),
      locales: hasOtherLocale.has(row.id) ? [locale, other] : [locale],
    };

    const entry: PoolEntry = {
      item,
      translation,
      categoryName: categoryNameById.get(chain.categoryId) ?? "",
    };

    if (row.picture_item_details) {
      entry.picture = { storagePath: row.picture_item_details.storage_path };
    }
    if (row.music_item_details) {
      entry.music = {
        storagePath: row.music_item_details.storage_path,
        artist: row.music_item_details.artist,
        title: row.music_item_details.title,
      };
    }

    entries.push(entry);
  }

  return entries;
}
