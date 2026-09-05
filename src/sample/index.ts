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
 * Resolves the Category id used for every one of the 8 slots, honouring
 * customer picks. Throws (input validation, not a GenerationFailure) when
 * the request's picks themselves are invalid; returns a GenerationFailure
 * (categoryId null) when the pool simply doesn't have enough distinct
 * Categories left to assign to every unassigned slot - a content shortfall.
 */
function resolveSlotCategories(
  request: QuizRequest,
  pool: readonly PoolItem[],
  random: RandomSource,
): ResolveSlotCategoriesResult {
  const { quizMode, categoryPicks } = request;

  if (quizMode === "single_category") {
    const categoryId = categoryPicks.find((pick): pick is string => pick !== undefined);
    if (categoryId === undefined) {
      throw new Error("single_category mode requires at least one category pick");
    }
    return { ok: true, slotCategories: new Array(SLOT_COUNT).fill(categoryId) };
  }

  const definedPicks = categoryPicks.filter((pick): pick is string => pick !== undefined);
  if (new Set(definedPicks).size !== definedPicks.length) {
    throw new Error("mixed mode requires distinct Category picks across slots");
  }

  const usedCategories = new Set(definedPicks);
  const poolCategoryIds = Array.from(new Set(pool.map((item) => item.categoryId)));
  const candidates = poolCategoryIds.filter((id) => !usedCategories.has(id));

  const slotCategories: string[] = [];
  for (let slotIndex = 0; slotIndex < SLOT_COUNT; slotIndex++) {
    const pick = categoryPicks[slotIndex];
    if (pick !== undefined) {
      slotCategories.push(pick);
      continue;
    }
    if (candidates.length === 0) {
      return {
        ok: false,
        failure: { slotIndex, categoryId: null, shortfall: SLOT_COUNT - slotIndex },
      };
    }
    const index = pickIndex(candidates.length, random);
    const [categoryId] = candidates.splice(index, 1);
    usedCategories.add(categoryId);
    slotCategories.push(categoryId);
  }
  return { ok: true, slotCategories };
}

/**
 * Samples a Composition for the request from the pool, or returns the first
 * GenerationFailure. In `single_category` mode the Category is the first
 * defined entry of `request.categoryPicks`; in `mixed` mode unassigned slots
 * are filled from Categories present in the pool that no other slot uses.
 */
export function sampleComposition(input: SampleInput): SampleResult {
  const { request, pool, excludedItemIds, random } = input;

  const resolved = resolveSlotCategories(request, pool, random);
  if (!resolved.ok) {
    return resolved;
  }
  const { slotCategories } = resolved;
  const slots: string[][] = [];

  for (let slotIndex = 0; slotIndex < SLOT_COUNT; slotIndex++) {
    const categoryId = slotCategories[slotIndex];
    const result = fillSlot({
      kind: SLOT_KINDS[slotIndex],
      categoryId,
      locale: request.locale,
      requestedDifficulty: request.requestedDifficulty,
      pool,
      excludedItemIds,
      random,
      itemsPerSlot: ITEMS_PER_SLOT,
    });

    if (result.shortfall > 0) {
      return { ok: false, failure: { slotIndex, categoryId, shortfall: result.shortfall } };
    }
    slots.push(result.itemIds);
  }

  const composition: Composition = { slots };
  return { ok: true, composition };
}
