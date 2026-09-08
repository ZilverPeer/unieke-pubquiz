/**
 * Pool coverage and dry-run seams: pure read-side views over the sampler's
 * own rules, so an admin coverage page and a pre-payment feasibility check
 * (spec 5) can never disagree with what `sampleComposition` would actually
 * do. No I/O, imports only from `@/domain` and the sampler's own modules.
 */
import type { ItemKind, Locale, PoolItem, QuizRequest, RequestedDifficulty } from "@/domain";
import { ITEMS_PER_SLOT, SLOT_COUNT, SLOT_KINDS } from "@/domain";
import { createSeededRandom } from "./random";
import type { RandomSource } from "./random";
import { resolveSlotCategories } from "./slot-categories";
import { fillSlot } from "./slots";

/**
 * Same shape as `index.ts`'s `SampleInput` (kept structurally compatible,
 * not imported, so this module never imports from `index.ts` - `index.ts`
 * re-exports this module, which would otherwise be a cycle).
 */
export interface DryRunInput {
  request: QuizRequest;
  pool: readonly PoolItem[];
  /** Item ids already delivered to this billing email (the no-repeat rule). */
  excludedItemIds: ReadonlySet<string>;
  random: RandomSource;
}

const KINDS: readonly ItemKind[] = Array.from(new Set(SLOT_KINDS));
const REQUESTED_DIFFICULTIES: readonly RequestedDifficulty[] = ["easy", "medium", "hard", "mixed"];
const LOCALES: readonly Locale[] = ["nl", "en"];
/** The three possible placements of `mixed`'s 4/3/3 extra: easy, medium, hard. */
const MIXED_EXTRA_INDICES: readonly number[] = [0, 1, 2];
/** `fits` asks only whether a full assignment exists, not for a random pick among them. */
const COVERAGE_RANDOM_SEED = 0;

export interface CoverageCell {
  categoryId: string;
  kind: ItemKind;
  requestedDifficulty: RequestedDifficulty;
  locale: Locale;
  /** Items of that kind, Category, Locale, not excluded; for mixed: all three Difficulty levels. */
  eligibleItems: number;
  /** Distinct Subsubcategories among the eligible Items. */
  subsubcategories: number;
  /** Whether a full Round of ITEMS_PER_SLOT can be filled by the sampler's own rules. */
  fits: boolean;
}

function isEligible(
  item: PoolItem,
  kind: ItemKind,
  categoryId: string,
  locale: Locale,
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
 * Reuses `fillSlot` (not a re-implementation): a single Difficulty is one
 * `fillSlot` call; `mixed` fits only when every one of the three possible
 * 4/3/3 extra placements has no shortfall, since `sampleComposition` may
 * draw any of the three for an actual Round - `fits` has to hold regardless
 * of which one that turns out to be. A fixed local seed drives the
 * (irrelevant to `fits`, which only asks whether a full assignment exists)
 * random draws inside `fillSlot`.
 */
function fits(
  kind: ItemKind,
  categoryId: string,
  locale: Locale,
  requestedDifficulty: RequestedDifficulty,
  pool: readonly PoolItem[],
  excludedItemIds: ReadonlySet<string>,
): boolean {
  const random = createSeededRandom(COVERAGE_RANDOM_SEED);

  if (requestedDifficulty === "mixed") {
    return MIXED_EXTRA_INDICES.every(
      (quotaExtraIndex) =>
        fillSlot({
          kind,
          categoryId,
          locale,
          requestedDifficulty,
          pool,
          excludedItemIds,
          random,
          itemsPerSlot: ITEMS_PER_SLOT,
          quotaExtraIndex,
        }).shortfall === 0,
    );
  }

  return (
    fillSlot({
      kind,
      categoryId,
      locale,
      requestedDifficulty,
      pool,
      excludedItemIds,
      random,
      itemsPerSlot: ITEMS_PER_SLOT,
    }).shortfall === 0
  );
}

/**
 * One `CoverageCell` per (Category present in the pool) x kind x
 * requestedDifficulty (easy, medium, hard, mixed) x Locale, sorted by
 * categoryId, kind (`SLOT_KINDS` order), Difficulty, then Locale (nl, en).
 */
export function computeCoverage(
  pool: readonly PoolItem[],
  excludedItemIds: ReadonlySet<string> = new Set(),
): CoverageCell[] {
  const categoryIds = Array.from(new Set(pool.map((item) => item.categoryId))).sort();

  const cells: CoverageCell[] = [];
  for (const categoryId of categoryIds) {
    for (const kind of KINDS) {
      for (const requestedDifficulty of REQUESTED_DIFFICULTIES) {
        for (const locale of LOCALES) {
          const eligibleItems = pool.filter(
            (item) =>
              isEligible(item, kind, categoryId, locale, excludedItemIds) &&
              (requestedDifficulty === "mixed" || item.difficulty === requestedDifficulty),
          );
          const subsubcategories = new Set(eligibleItems.map((item) => item.subsubcategoryId)).size;

          cells.push({
            categoryId,
            kind,
            requestedDifficulty,
            locale,
            eligibleItems: eligibleItems.length,
            subsubcategories,
            fits: fits(kind, categoryId, locale, requestedDifficulty, pool, excludedItemIds),
          });
        }
      }
    }
  }
  return cells;
}

export interface DryRunShortfall {
  slotIndex: number;
  kind: ItemKind;
  categoryId: string | null;
  requestedDifficulty: RequestedDifficulty;
  shortfall: number;
}

/**
 * Reports every slot (not just the first) that a Quiz request would fall
 * short on, in slot order, without persisting anything. Walks the slots the
 * same way `sampleComposition` does - same `resolveSlotCategories`, same
 * growing exclusion set - but continues past a short slot instead of
 * stopping there, adding whatever it could place to the exclusions so a
 * later slot of the same kind still sees a correctly shrunk pool. For the
 * same input and seed, the first entry equals `sampleComposition`'s failure;
 * an empty array means the request generates.
 *
 * When the pool doesn't have enough distinct Categories to give every slot
 * one (only reachable with 0 picks - `resolveSlotCategories` itself fails),
 * there is nothing left to walk slot by slot: the result is a single
 * aggregate entry covering every slot from that point onward
 * (`categoryId: null`, `shortfall` the count of such slots), the same shape
 * `sampleComposition`'s own failure takes - not one entry per un-categorised
 * slot.
 */
export function dryRunRequest(input: DryRunInput): DryRunShortfall[] {
  const { request, pool, excludedItemIds, random } = input;

  const resolved = resolveSlotCategories(request, pool, random);
  if (!resolved.ok) {
    const { failure } = resolved;
    return [
      {
        slotIndex: failure.slotIndex,
        kind: SLOT_KINDS[failure.slotIndex],
        categoryId: failure.categoryId,
        requestedDifficulty: request.requestedDifficulty,
        shortfall: failure.shortfall,
      },
    ];
  }

  const { slotCategories } = resolved;
  const shortfalls: DryRunShortfall[] = [];
  const placedItemIds = new Set<string>(excludedItemIds);

  for (let slotIndex = 0; slotIndex < SLOT_COUNT; slotIndex++) {
    const categoryId = slotCategories[slotIndex];
    const kind = SLOT_KINDS[slotIndex];
    const result = fillSlot({
      kind,
      categoryId,
      locale: request.locale,
      requestedDifficulty: request.requestedDifficulty,
      pool,
      excludedItemIds: placedItemIds,
      random,
      itemsPerSlot: ITEMS_PER_SLOT,
    });

    if (result.shortfall > 0) {
      shortfalls.push({
        slotIndex,
        kind,
        categoryId,
        requestedDifficulty: request.requestedDifficulty,
        shortfall: result.shortfall,
      });
    }
    for (const id of result.itemIds) {
      placedItemIds.add(id);
    }
  }

  return shortfalls;
}
