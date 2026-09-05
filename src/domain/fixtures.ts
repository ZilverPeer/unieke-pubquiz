import type { ItemContent, QuizContent, RoundContent } from "./content";
import type { Difficulty, ItemKind, Locale, PoolItem } from "./types";
import { ITEMS_PER_SLOT, SLOT_KINDS } from "./types";

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
          locales,
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

/** A valid 1x1 white PNG, the smallest image @react-pdf/renderer will embed. */
const ONE_PIXEL_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
    "base64",
  ),
);

const LOCALE_FIXTURE_WORDS: Record<
  Locale,
  { question: string; about: string; answer: string; fact: string; category: string }
> = {
  nl: {
    question: "Fixturevraag",
    about: "over",
    answer: "Fixtureantwoord",
    fact: "Fixtureweetje",
    category: "Categorie",
  },
  en: {
    question: "Fixture question",
    about: "about",
    answer: "Fixture answer",
    fact: "Fixture fact",
    category: "Category",
  },
};

export interface QuizContentFixtureOptions {
  locale: Locale;
  /** Image bytes for every Picture Item; defaults to a 1x1 PNG. */
  image?: Uint8Array;
  /** Clip bytes for every Music Item; defaults to empty (fine for PDF tests, not for ffmpeg). */
  clip?: Uint8Array;
}

/**
 * Builds a complete QuizContent (8 Rounds x 10 Items) with deterministic
 * strings in the requested Locale, for renderer smoke tests. Strings embed
 * Locale-specific words so a test can assert nothing from the other Locale
 * leaks. Every 7th Item carries a Fact.
 */
export function buildQuizContentFixture(options: QuizContentFixtureOptions): QuizContent {
  const { locale, image = ONE_PIXEL_PNG, clip = new Uint8Array() } = options;
  const words = LOCALE_FIXTURE_WORDS[locale];

  const rounds: RoundContent[] = SLOT_KINDS.map((kind, slotIndex) => {
    const items: ItemContent[] = [];
    for (let position = 0; position < ITEMS_PER_SLOT; position++) {
      const n = slotIndex * ITEMS_PER_SLOT + position + 1;
      const id = `fixture-${kind}-${n}`;
      const fact = n % 7 === 0 ? `${words.fact} ${n}` : undefined;
      if (kind === "text") {
        items.push({
          id,
          kind,
          question: `${words.question} ${n} ${words.about} ${words.category} ${slotIndex + 1}?`,
          answer: `${words.answer} ${n}`,
          fact,
        });
      } else if (kind === "picture") {
        items.push({ id, kind, answer: `${words.answer} ${n}`, fact, image });
      } else {
        items.push({
          id,
          kind,
          artist: `Fixture Artist ${position + 1}`,
          title: `Fixture Track ${n}`,
          fact,
          clip,
        });
      }
    }
    return { slotIndex, kind, categoryName: `${words.category} ${slotIndex + 1}`, items };
  });

  return { locale, rounds };
}
