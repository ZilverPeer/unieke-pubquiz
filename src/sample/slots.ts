/**
 * Slot-filling helpers: choosing Items for one Round slot under the
 * no-shared-Subsubcategory rule and the Difficulty rules. Private to
 * src/sample; not part of the public seam.
 */
import type { Difficulty, ItemKind, PoolItem, RequestedDifficulty } from "@/domain";
import { pickIndex, shuffleInPlace } from "./shuffle";
import { maximumBipartiteMatching } from "./matching";
import type { RandomSource } from "./random";

const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];

export interface SlotPickResult {
  itemIds: string[];
  /** How many of the requested Items could not be placed (0 when full). */
  shortfall: number;
}

function isEligible(
  item: PoolItem,
  kind: ItemKind,
  categoryId: string,
  locale: PoolItem["locales"][number],
  excludedItemIds: ReadonlySet<string>,
): boolean {
  return (
    item.kind === kind &&
    item.categoryId === categoryId &&
    item.locales.includes(locale) &&
    !excludedItemIds.has(item.id)
  );
}

/**
 * Builds the requested-Difficulty quota for one slot as a flat list of one
 * entry per requested Item: a single Difficulty requests `itemsPerSlot` of
 * that level; `mixed` splits it 4/3/3 across easy/medium/hard, with the
 * level getting the extra one chosen by `random` here, before any matching
 * draws. This is the only draw shared with the pre-matching implementation -
 * every later draw differs, so a given seed does not reproduce the same
 * Composition as the old greedy fill.
 */
function buildQuota(
  requestedDifficulty: RequestedDifficulty,
  itemsPerSlot: number,
  random: RandomSource,
): Difficulty[] {
  if (requestedDifficulty !== "mixed") {
    return new Array(itemsPerSlot).fill(requestedDifficulty) as Difficulty[];
  }

  const extraIndex = pickIndex(DIFFICULTIES.length, random);
  const base = Math.floor(itemsPerSlot / DIFFICULTIES.length);
  const extra = itemsPerSlot - base * DIFFICULTIES.length;

  const quota: Difficulty[] = [];
  DIFFICULTIES.forEach((difficulty, index) => {
    const needed = index === extraIndex ? base + extra : base;
    for (let i = 0; i < needed; i++) quota.push(difficulty);
  });
  return quota;
}

export interface FillSlotInput {
  kind: ItemKind;
  categoryId: string;
  locale: PoolItem["locales"][number];
  requestedDifficulty: RequestedDifficulty;
  pool: readonly PoolItem[];
  excludedItemIds: ReadonlySet<string>;
  random: RandomSource;
  itemsPerSlot: number;
}

/**
 * Fills one Round slot with an exact assignment: the requested Difficulty
 * quota (single-Difficulty is just `itemsPerSlot` of one level; `mixed` is
 * the 4/3/3 split) is expanded into one "quota slot" per requested Item.
 * Each quota slot has an edge to every Subsubcategory that has at least one
 * eligible Item of that quota slot's Difficulty; a maximum bipartite
 * matching (`maximumBipartiteMatching`) assigns each quota slot to a
 * distinct Subsubcategory wherever an assignment exists. A shortfall is
 * therefore only reported when no full assignment exists at all - never
 * from an unlucky greedy per-level pick order, for single-Difficulty and
 * mixed requests alike. Final position order is randomised.
 */
export function fillSlot(input: FillSlotInput): SlotPickResult {
  const { kind, categoryId, locale, requestedDifficulty, pool, excludedItemIds, random, itemsPerSlot } =
    input;

  const eligibleByDifficulty = new Map<Difficulty, Map<string, PoolItem[]>>();
  for (const difficulty of DIFFICULTIES) {
    eligibleByDifficulty.set(difficulty, new Map());
  }
  for (const item of pool) {
    if (!isEligible(item, kind, categoryId, locale, excludedItemIds)) continue;
    const bySubsubcategory = eligibleByDifficulty.get(item.difficulty)!;
    const group = bySubsubcategory.get(item.subsubcategoryId);
    if (group) {
      group.push(item);
    } else {
      bySubsubcategory.set(item.subsubcategoryId, [item]);
    }
  }

  const quota = buildQuota(requestedDifficulty, itemsPerSlot, random);
  const slotEligibleIds = quota.map((difficulty) =>
    Array.from(eligibleByDifficulty.get(difficulty)!.keys()),
  );

  const { assignment, matchingSize } = maximumBipartiteMatching(slotEligibleIds, random);

  const itemIds: string[] = [];
  assignment.forEach((subsubcategoryId, index) => {
    if (subsubcategoryId === undefined) return;
    const difficulty = quota[index];
    const group = eligibleByDifficulty.get(difficulty)!.get(subsubcategoryId)!;
    itemIds.push(group[pickIndex(group.length, random)].id);
  });

  return { itemIds: shuffleInPlace(itemIds, random), shortfall: itemsPerSlot - matchingSize };
}
