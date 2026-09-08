/**
 * Shared domain types. Vocabulary matches CONTEXT.md exactly.
 * This module imports nothing from other src modules.
 */

export type Locale = "nl" | "en";

export type ItemKind = "text" | "picture" | "music";

export type Difficulty = "easy" | "medium" | "hard";

export type RequestedDifficulty = Difficulty | "mixed";

/** The fixed kind of Item sampled into each of the 8 Round slots, in slot order. */
export const SLOT_KINDS: readonly ItemKind[] = [
  "text",
  "text",
  "text",
  "text",
  "text",
  "text",
  "picture",
  "music",
];

export const SLOT_COUNT = SLOT_KINDS.length;

export const ITEMS_PER_SLOT = 10;

export interface QuizRequest {
  locale: Locale;
  /**
   * The customer's Category ids, in pick order, 0 to 8 entries, distinct.
   * Cycled evenly over the 8 Round slots: with k picks (k >= 1), slot i gets
   * pick `i % k`; with 0 picks, every slot gets a random Category, distinct
   * across slots. See src/sample/README.md "Categories".
   */
  categoryPicks: string[];
  requestedDifficulty: RequestedDifficulty;
  billingEmail: string;
}

/**
 * An Item as seen by sampling: its kind, Difficulty, full Category chain, and
 * the Locales it has a translation for. Sampling only chooses an Item whose
 * `locales` include the requested Locale.
 */
export interface PoolItem {
  id: string;
  kind: ItemKind;
  difficulty: Difficulty;
  categoryId: string;
  subcategoryId: string;
  subsubcategoryId: string;
  locales: readonly Locale[];
}

/** The sampled Item ids per Round slot, source of the no-repeat rule. */
export interface Composition {
  /** Exactly 8 slots, each exactly ITEMS_PER_SLOT Item ids, kind per SLOT_KINDS. */
  slots: readonly (readonly string[])[];
}

/**
 * A hard-fail reason when a slot cannot be filled - either because there
 * were not enough Items (categoryId is the slot's Category, shortfall is how
 * many Items short of ITEMS_PER_SLOT it ended up), or because there was no
 * Category left to assign to this slot at all (categoryId is null, shortfall
 * is how many slots from this one onward are left without a Category).
 */
export interface GenerationFailure {
  slotIndex: number;
  categoryId: string | null;
  shortfall: number;
}

/** Everything the repository stores alongside a Composition's slots. */
export interface CompositionRecord {
  billingEmail: string;
  locale: Locale;
  requestedDifficulty: RequestedDifficulty;
  seed: number;
  composition: Composition;
}
