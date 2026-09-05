/**
 * Slot-filling helpers: choosing Items for one Round slot under the
 * no-shared-Subsubcategory rule and the Difficulty rules. Private to
 * src/sample; not part of the public seam.
 */
import type { Difficulty, ItemKind, PoolItem, RequestedDifficulty } from "@/domain";
import { pickIndex, shuffleInPlace } from "./shuffle";
import type { RandomSource } from "./random";

const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];

export interface SlotPickResult {
  itemIds: string[];
  /** How many of the requested Items could not be placed (0 when full). */
  shortfall: number;
}

interface SubsubcategoryPickResult extends SlotPickResult {
  subsubcategoryIds: string[];
}

/**
 * Picks up to `needed` Items from `eligible`, choosing at most one Item per
 * Subsubcategory so a shortfall only happens when there are genuinely fewer
 * than `needed` distinct eligible Subsubcategories - never from an unlucky
 * greedy pick. Which Subsubcategories (and which Item within one) are chosen
 * is driven by `random`.
 */
function pickWithSubsubcategoryLimit(
  eligible: readonly PoolItem[],
  needed: number,
  random: RandomSource,
): SubsubcategoryPickResult {
  const bySubsubcategory = new Map<string, PoolItem[]>();
  for (const item of eligible) {
    const group = bySubsubcategory.get(item.subsubcategoryId);
    if (group) {
      group.push(item);
    } else {
      bySubsubcategory.set(item.subsubcategoryId, [item]);
    }
  }

  const subsubcategoryIds = shuffleInPlace(Array.from(bySubsubcategory.keys()), random);
  const chosenSubsubcategoryIds = subsubcategoryIds.slice(0, needed);

  const itemIds = chosenSubsubcategoryIds.map((subsubcategoryId) => {
    const group = bySubsubcategory.get(subsubcategoryId)!;
    return group[pickIndex(group.length, random)].id;
  });

  return { itemIds, subsubcategoryIds: chosenSubsubcategoryIds, shortfall: needed - itemIds.length };
}

function isEligible(
  item: PoolItem,
  kind: ItemKind,
  categoryId: string,
  locale: PoolItem["locales"][number],
  excludedItemIds: ReadonlySet<string>,
  usedSubsubcategoryIds: ReadonlySet<string>,
): boolean {
  return (
    item.kind === kind &&
    item.categoryId === categoryId &&
    item.locales.includes(locale) &&
    !excludedItemIds.has(item.id) &&
    !usedSubsubcategoryIds.has(item.subsubcategoryId)
  );
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
 * Fills one Round slot: single-Difficulty requests pick `itemsPerSlot` Items
 * of that Difficulty; `mixed` picks a 4/3/3 split across easy/medium/hard,
 * with the Difficulty that gets 4 chosen by `random`, while still honouring
 * the no-shared-Subsubcategory rule across all three Difficulties combined.
 * Final position order is randomised.
 */
export function fillSlot(input: FillSlotInput): SlotPickResult {
  const { kind, categoryId, locale, requestedDifficulty, pool, excludedItemIds, random, itemsPerSlot } =
    input;

  if (requestedDifficulty !== "mixed") {
    const noneUsed = new Set<string>();
    const eligible = pool.filter((item) =>
      isEligible(item, kind, categoryId, locale, excludedItemIds, noneUsed) &&
      item.difficulty === requestedDifficulty,
    );
    const result = pickWithSubsubcategoryLimit(eligible, itemsPerSlot, random);
    return { itemIds: shuffleInPlace(result.itemIds, random), shortfall: result.shortfall };
  }

  const extraIndex = pickIndex(DIFFICULTIES.length, random);
  const base = Math.floor(itemsPerSlot / DIFFICULTIES.length);
  const extra = itemsPerSlot - base * DIFFICULTIES.length;

  const usedSubsubcategoryIds = new Set<string>();
  const itemIds: string[] = [];
  let shortfall = 0;

  DIFFICULTIES.forEach((difficulty, index) => {
    const needed = index === extraIndex ? base + extra : base;
    const eligible = pool.filter((item) =>
      isEligible(item, kind, categoryId, locale, excludedItemIds, usedSubsubcategoryIds) &&
      item.difficulty === difficulty,
    );
    const result = pickWithSubsubcategoryLimit(eligible, needed, random);
    for (const subsubcategoryId of result.subsubcategoryIds) {
      usedSubsubcategoryIds.add(subsubcategoryId);
    }
    itemIds.push(...result.itemIds);
    shortfall += result.shortfall;
  });

  return { itemIds: shuffleInPlace(itemIds, random), shortfall };
}
