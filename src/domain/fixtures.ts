import type { Difficulty, ItemKind, Locale, PoolItem } from "./types";

const KINDS: readonly ItemKind[] = ["text", "picture", "music"];
const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];

export interface CategoryFixture {
  id: string;
  name: string;
}

export interface SubcategoryFixture {
  id: string;
  categoryId: string;
  name: string;
}

export interface SubsubcategoryFixture {
  id: string;
  subcategoryId: string;
  categoryId: string;
  name: string;
}

export interface ItemTranslationFixture {
  question?: string;
  answer: string;
  fact?: string;
}

export interface PoolFixtureOptions {
  /** Locales to generate a translation for, for every Item in the pool. */
  locales: Locale[];
  /** Number of Categories to build (each with one Subcategory). */
  categories: number;
  /** Number of Subsubcategories to build under each Category's Subcategory. */
  subsubcategoriesPerCategory: number;
  /** Number of Items to build for each (kind, Difficulty) combination. */
  itemsPerKindPerDifficulty: number;
}

export interface PoolFixture {
  pool: PoolItem[];
  categories: CategoryFixture[];
  subcategories: SubcategoryFixture[];
  subsubcategories: SubsubcategoryFixture[];
  /** Per-Locale translation lookup, keyed by Item id. */
  translations: Record<Locale, Map<string, ItemTranslationFixture>>;
}

/**
 * Builds an in-memory pool of PoolItems (plus their Category chain and
 * per-Locale translations) for use as sampling test fixtures. Round-robins
 * generated Items across the built Subsubcategories.
 */
export function buildPoolFixture(options: PoolFixtureOptions): PoolFixture {
  const {
    locales,
    categories: categoryCount,
    subsubcategoriesPerCategory,
    itemsPerKindPerDifficulty,
  } = options;

  const categories: CategoryFixture[] = [];
  const subcategories: SubcategoryFixture[] = [];
  const subsubcategories: SubsubcategoryFixture[] = [];

  for (let c = 0; c < categoryCount; c++) {
    const categoryId = `category-${c}`;
    categories.push({ id: categoryId, name: `Category ${c}` });

    const subcategoryId = `subcategory-${c}`;
    subcategories.push({ id: subcategoryId, categoryId, name: `Subcategory ${c}` });

    for (let s = 0; s < subsubcategoriesPerCategory; s++) {
      subsubcategories.push({
        id: `subsubcategory-${c}-${s}`,
        subcategoryId,
        categoryId,
        name: `Subsubcategory ${c}-${s}`,
      });
    }
  }

  if (subsubcategories.length === 0) {
    throw new Error(
      "buildPoolFixture requires at least one Category with at least one Subsubcategory",
    );
  }

  const pool: PoolItem[] = [];
  const translations: Record<Locale, Map<string, ItemTranslationFixture>> = Object.fromEntries(
    locales.map((locale) => [locale, new Map<string, ItemTranslationFixture>()]),
  ) as Record<Locale, Map<string, ItemTranslationFixture>>;

  let itemCounter = 0;
  for (const kind of KINDS) {
    for (const difficulty of DIFFICULTIES) {
      for (let i = 0; i < itemsPerKindPerDifficulty; i++) {
        const subsubcategory = subsubcategories[itemCounter % subsubcategories.length];
        const id = `item-${kind}-${difficulty}-${itemCounter}`;
        itemCounter++;

        pool.push({
          id,
          kind,
          difficulty,
          categoryId: subsubcategory.categoryId,
          subcategoryId: subsubcategory.subcategoryId,
          subsubcategoryId: subsubcategory.id,
        });

        for (const locale of locales) {
          translations[locale].set(id, {
            question: kind === "text" ? `Question ${id} (${locale})` : undefined,
            answer: `Answer ${id} (${locale})`,
            fact: undefined,
          });
        }
      }
    }
  }

  return { pool, categories, subcategories, subsubcategories, translations };
}
