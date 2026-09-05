/**
 * Shared domain types. Vocabulary matches CONTEXT.md exactly.
 * This module imports nothing from other src modules.
 */

export type Locale = "nl" | "en";

export type QuizMode = "mixed" | "single_category";

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

/** A customer's Category pick for one of the 8 slots, or undefined to randomize it. */
export type CategoryPick = string | undefined;

export interface QuizRequest {
  locale: Locale;
  quizMode: QuizMode;
  /** Category id per slot (index 0-7), undefined where the slot is unassigned. */
  categoryPicks: CategoryPick[];
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

/** A hard-fail reason when a slot cannot be filled to ITEMS_PER_SLOT Items. */
export interface GenerationFailure {
  slotIndex: number;
  categoryId: string;
  /** How many Items short of ITEMS_PER_SLOT the slot ended up. */
  shortfall: number;
}

/** Everything the repository stores alongside a Composition's slots. */
export interface CompositionRecord {
  billingEmail: string;
  locale: Locale;
  quizMode: QuizMode;
  requestedDifficulty: RequestedDifficulty;
  seed: number;
  composition: Composition;
}
