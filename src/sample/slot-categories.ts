/**
 * Category resolution for the 8 Round slots. Its own module (not
 * `index.ts`) so `coverage.ts` can import it without a module cycle through
 * `index.ts`.
 */
import type { GenerationFailure, PoolItem, QuizRequest } from "@/domain";
import { SLOT_COUNT } from "@/domain";
import { pickIndex } from "./shuffle";
import type { RandomSource } from "./random";

export type ResolveSlotCategoriesResult =
  | { ok: true; slotCategories: string[] }
  | { ok: false; failure: GenerationFailure };

/**
 * Resolves the Category id used for every one of the 8 slots, cycling the
 * customer's picks evenly over the slots in pick order: with k picks (k >= 1),
 * slot i gets pick `i % k`. Throws (input validation, not a
 * GenerationFailure) when the request's picks themselves are invalid -
 * more than 8, or not distinct. With 0 picks, every slot gets a random
 * Category, distinct across slots (a content shortfall - returned as a
 * GenerationFailure with categoryId null - when the pool doesn't have 8
 * distinct Categories to give).
 *
 * Used by both `sampleComposition` (`index.ts`) and `dryRunRequest`
 * (`coverage.ts`) so they walk slots the same way instead of each
 * re-implementing the cycle rule.
 */
export function resolveSlotCategories(
  request: QuizRequest,
  pool: readonly PoolItem[],
  random: RandomSource,
): ResolveSlotCategoriesResult {
  const { categoryPicks } = request;

  if (categoryPicks.length > SLOT_COUNT) {
    throw new Error(`at most ${SLOT_COUNT} Category picks`);
  }
  if (new Set(categoryPicks).size !== categoryPicks.length) {
    throw new Error("Category picks must be distinct");
  }

  const k = categoryPicks.length;
  if (k > 0) {
    const slotCategories = Array.from({ length: SLOT_COUNT }, (_, slotIndex) => categoryPicks[slotIndex % k]);
    return { ok: true, slotCategories };
  }

  const poolCategoryIds = Array.from(new Set(pool.map((item) => item.categoryId)));
  const candidates = [...poolCategoryIds];

  const slotCategories: string[] = [];
  for (let slotIndex = 0; slotIndex < SLOT_COUNT; slotIndex++) {
    if (candidates.length === 0) {
      return {
        ok: false,
        failure: { slotIndex, categoryId: null, shortfall: SLOT_COUNT - slotIndex },
      };
    }
    const index = pickIndex(candidates.length, random);
    const [categoryId] = candidates.splice(index, 1);
    slotCategories.push(categoryId);
  }
  return { ok: true, slotCategories };
}
