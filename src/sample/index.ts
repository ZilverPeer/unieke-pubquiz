/**
 * Sampling: Items -> Composition. Pure, no I/O. Imports only src/domain.
 */
import type { Composition, GenerationFailure, PoolItem, QuizRequest } from "@/domain";
import { ITEMS_PER_SLOT, SLOT_COUNT, SLOT_KINDS } from "@/domain";
import { fillSlot } from "./slots";
import { resolveSlotCategories } from "./slot-categories";
import type { RandomSource } from "./random";

export type { RandomSource } from "./random";
export { createSeededRandom } from "./random";
export type { CoverageCell, DryRunShortfall } from "./coverage";
export { computeCoverage, dryRunRequest } from "./coverage";
export type { ResolveSlotCategoriesResult } from "./slot-categories";
export { resolveSlotCategories } from "./slot-categories";

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
