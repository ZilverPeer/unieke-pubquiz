/**
 * Sampling: Items -> Composition. Pure, no I/O. Imports only src/domain.
 */
import type { Composition, GenerationFailure, PoolItem, QuizRequest } from "@/domain";
import { ITEMS_PER_SLOT, SLOT_COUNT, SLOT_KINDS } from "@/domain";
import { pickIndex } from "./shuffle";
import { fillSlot } from "./slots";
import type { RandomSource } from "./random";

export type { RandomSource } from "./random";
export { createSeededRandom } from "./random";

export interface SampleInput {
  request: QuizRequest;
  pool: readonly PoolItem[];
  /** Item ids already delivered to this billing email (the no-repeat rule). */
  excludedItemIds: ReadonlySet<string>;
  random: RandomSource;
}

export type SampleResult =
  | { ok: true; composition: Composition }
  | { ok: false; failure: GenerationFailure };

type ResolveSlotCategoriesResult =
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
 */
function resolveSlotCategories(
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

/**
 * Samples a Composition for the request from the pool, or returns the first
 * GenerationFailure. `request.categoryPicks` is cycled evenly over the 8
 * slots in pick order (slot i gets pick `i % k`); with 0 picks every slot
 * gets a random Category, distinct across slots.
 */
export function sampleComposition(input: SampleInput): SampleResult {
  const { request, pool, excludedItemIds, random } = input;

  const resolved = resolveSlotCategories(request, pool, random);
  if (!resolved.ok) {
    return resolved;
  }
  const { slotCategories } = resolved;
  const slots: string[][] = [];
  // Items placed in earlier slots must not be reused by later slots of the
  // same Composition (with fewer than 8 picks, several slots share a
  // Category -- the cycle rule, see resolveSlotCategories above). Seed the
  // union with the caller's own exclusions, then grow it as each slot is
  // filled; a later slot that cannot be filled without repeating an
  // already-placed Item is a genuine shortfall for that slot.
  const placedItemIds = new Set<string>(excludedItemIds);

  for (let slotIndex = 0; slotIndex < SLOT_COUNT; slotIndex++) {
    const categoryId = slotCategories[slotIndex];
    const result = fillSlot({
      kind: SLOT_KINDS[slotIndex],
      categoryId,
      locale: request.locale,
      requestedDifficulty: request.requestedDifficulty,
      pool,
      excludedItemIds: placedItemIds,
      random,
      itemsPerSlot: ITEMS_PER_SLOT,
    });

    if (result.shortfall > 0) {
      return { ok: false, failure: { slotIndex, categoryId, shortfall: result.shortfall } };
    }
    for (const id of result.itemIds) {
      placedItemIds.add(id);
    }
    slots.push(result.itemIds);
  }

  const composition: Composition = { slots };
  return { ok: true, composition };
}
