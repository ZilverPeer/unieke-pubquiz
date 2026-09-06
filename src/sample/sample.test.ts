import { describe, expect, test } from "vitest";
import { buildPoolFixture } from "@/domain/fixtures";
import type { CategoryPick, Difficulty, PoolItem, QuizRequest } from "@/domain";
import { ITEMS_PER_SLOT, SLOT_COUNT, SLOT_KINDS } from "@/domain";
import { createSeededRandom, sampleComposition } from "./index";

/**
 * A pool with 8 Categories, each with 10 Subsubcategories, and exactly one
 * Item per (Category, kind, Difficulty, Subsubcategory) combination - i.e.
 * exactly 10 eligible Items per (Category, kind, Difficulty), one per
 * Subsubcategory. Sufficient to fill any single slot at any Difficulty, and
 * to fill a full 8-slot mixed Quiz using 8 distinct Categories.
 */
function buildFullPool() {
  return buildPoolFixture({
    locales: ["nl"],
    categories: 8,
    subsubcategoriesPerCategory: 10,
    itemsPerKindPerDifficulty: 80,
  });
}

/**
 * A pool with 8 Categories, each with 10 Subsubcategories, and 7 Items per
 * (Category, kind, Difficulty, Subsubcategory) combination - i.e. 70
 * eligible Items per (Category, kind, Difficulty). `single_category` mode
 * puts 6 "text" slots on the same Category with no refill between slots
 * (sampleComposition excludes Items already placed by earlier slots), so
 * this needs comfortably more per-Category density than `buildFullPool`'s
 * exact 1-per-Subsubcategory (which is deliberately zero-slack for `mixed`
 * mode, where every slot has a distinct Category): 70 text-easy Items give
 * 6 slots of 10 (60 needed) 10 Items of headroom.
 */
function buildSingleCategoryPool() {
  return buildPoolFixture({
    locales: ["nl"],
    categories: 8,
    subsubcategoriesPerCategory: 10,
    itemsPerKindPerDifficulty: 560,
  });
}

function baseRequest(overrides: Partial<QuizRequest> = {}): QuizRequest {
  return {
    locale: "nl",
    quizMode: "mixed",
    categoryPicks: new Array(SLOT_COUNT).fill(undefined) as CategoryPick[],
    requestedDifficulty: "easy",
    billingEmail: "player@example.com",
    ...overrides,
  };
}

function itemById(pool: readonly PoolItem[], id: string): PoolItem {
  const item = pool.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`test setup error: no pool item with id ${id}`);
  return item;
}

describe("sampleComposition", () => {
  test("a full mixed Quiz succeeds on a sufficient pool", () => {
    const { pool } = buildFullPool();
    const result = sampleComposition({
      request: baseRequest(),
      pool,
      excludedItemIds: new Set(),
      random: createSeededRandom(1),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.composition.slots).toHaveLength(SLOT_COUNT);
    result.composition.slots.forEach((slot, slotIndex) => {
      expect(slot).toHaveLength(ITEMS_PER_SLOT);
      for (const id of slot) {
        expect(itemById(pool, id).kind).toBe(SLOT_KINDS[slotIndex]);
      }
    });
  });

  test("customer picks land in their slots", () => {
    const { pool, categories } = buildFullPool();
    const picks: CategoryPick[] = new Array(SLOT_COUNT).fill(undefined);
    picks[0] = categories[2].id;
    picks[3] = categories[5].id;

    const result = sampleComposition({
      request: baseRequest({ categoryPicks: picks }),
      pool,
      excludedItemIds: new Set(),
      random: createSeededRandom(1),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const id of result.composition.slots[0]) {
      expect(itemById(pool, id).categoryId).toBe(categories[2].id);
    }
    for (const id of result.composition.slots[3]) {
      expect(itemById(pool, id).categoryId).toBe(categories[5].id);
    }
  });

  test("unassigned slots in mixed mode get Categories that differ from every pick and from each other", () => {
    const { pool, categories } = buildFullPool();
    const picks: CategoryPick[] = new Array(SLOT_COUNT).fill(undefined);
    picks[0] = categories[2].id;
    picks[3] = categories[5].id;

    const result = sampleComposition({
      request: baseRequest({ categoryPicks: picks }),
      pool,
      excludedItemIds: new Set(),
      random: createSeededRandom(1),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const categoryPerSlot = result.composition.slots.map((slot) => itemById(pool, slot[0]).categoryId);
    // Every slot's Category is unique across all 8 slots.
    expect(new Set(categoryPerSlot).size).toBe(SLOT_COUNT);
    // The picked slots keep their picks.
    expect(categoryPerSlot[0]).toBe(categories[2].id);
    expect(categoryPerSlot[3]).toBe(categories[5].id);
  });

  test("mixed mode rejects duplicate Category picks", () => {
    const { pool, categories } = buildFullPool();
    const picks: CategoryPick[] = new Array(SLOT_COUNT).fill(undefined);
    picks[0] = categories[2].id;
    picks[3] = categories[2].id;

    expect(() =>
      sampleComposition({
        request: baseRequest({ categoryPicks: picks }),
        pool,
        excludedItemIds: new Set(),
        random: createSeededRandom(1),
      }),
    ).toThrow(Error);
  });

  test("mixed mode with fewer pool Categories than unassigned slots fails with a null-Category shortfall", () => {
    // Only 3 distinct Categories in the pool, no picks: slots 0-2 can each
    // get a Category, slot 3 onward can't - a content shortfall, not a
    // caller error.
    const { pool } = buildPoolFixture({
      locales: ["nl"],
      categories: 3,
      subsubcategoriesPerCategory: 1,
      itemsPerKindPerDifficulty: 1,
    });

    const result = sampleComposition({
      request: baseRequest(),
      pool,
      excludedItemIds: new Set(),
      random: createSeededRandom(1),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure).toEqual({ slotIndex: 3, categoryId: null, shortfall: 5 });
  });

  test("single_category mode uses one Category for all 8 slots", () => {
    const { pool, categories } = buildSingleCategoryPool();
    const picks: CategoryPick[] = new Array(SLOT_COUNT).fill(undefined);
    picks[4] = categories[1].id;

    const result = sampleComposition({
      request: baseRequest({ quizMode: "single_category", categoryPicks: picks }),
      pool,
      excludedItemIds: new Set(),
      random: createSeededRandom(1),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const slot of result.composition.slots) {
      for (const id of slot) {
        expect(itemById(pool, id).categoryId).toBe(categories[1].id);
      }
    }
  });

  test("single_category mode never places the same Item in two slots", () => {
    // Repro from issue #34: one Category, ten Subsubcategories, ten Items
    // per (kind, Difficulty) - exactly enough for one slot's quota. In
    // single_category mode all 6 text slots share this one Category.
    // Before the fix, sampleComposition never excluded Items already
    // placed by earlier slots of the same Composition, so slot 0 and
    // slot 1 drew from the same untouched 10-Item pool and ended up with
    // the exact same Items (`ok: true`, no error, no repeat detected).
    // After the fix, that repeat is a genuine content shortfall - the
    // pool has nothing left to give slot 1 without repeating slot 0's
    // Items - not a silently duplicated slot.
    const { pool, categories } = buildPoolFixture({
      locales: ["nl"],
      categories: 1,
      subsubcategoriesPerCategory: 10,
      itemsPerKindPerDifficulty: 10,
    });

    const picks: CategoryPick[] = new Array(SLOT_COUNT).fill(undefined);
    picks[0] = categories[0].id;

    const result = sampleComposition({
      request: baseRequest({
        quizMode: "single_category",
        categoryPicks: picks,
        requestedDifficulty: "easy",
      }),
      pool,
      excludedItemIds: new Set(),
      random: createSeededRandom(1),
    });

    // No Item id may ever appear in two slots, regardless of the outcome:
    // if sampling succeeded, no two slots may share an Item id; if it
    // failed, that must be an honest shortfall, not a silent duplicate.
    if (result.ok) {
      const allIds = result.composition.slots.flat();
      expect(new Set(allIds).size).toBe(allIds.length);
    } else {
      expect(result.failure).toEqual({
        slotIndex: 1,
        categoryId: categories[0].id,
        shortfall: ITEMS_PER_SLOT,
      });
    }
  });

  test("single_category mode throws when no Category is picked", () => {
    const { pool } = buildFullPool();

    expect(() =>
      sampleComposition({
        request: baseRequest({ quizMode: "single_category" }),
        pool,
        excludedItemIds: new Set(),
        random: createSeededRandom(1),
      }),
    ).toThrow(Error);
  });

  test("no two Items in a slot share a Subsubcategory", () => {
    // 10 Subsubcategories with 7 Items each at "easy" so the fill has to
    // choose among several candidates per Subsubcategory, with enough
    // headroom (70 Items) for all 6 "text" slots to each draw a fresh 10
    // without repeating an Item already placed by an earlier slot.
    const { pool, categories } = buildPoolFixture({
      locales: ["nl"],
      categories: 1,
      subsubcategoriesPerCategory: 10,
      itemsPerKindPerDifficulty: 70,
    });

    const picks: CategoryPick[] = new Array(SLOT_COUNT).fill(undefined);
    picks[4] = categories[0].id;

    const result = sampleComposition({
      request: baseRequest({ quizMode: "single_category", categoryPicks: picks }),
      pool,
      excludedItemIds: new Set(),
      random: createSeededRandom(7),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const slot of result.composition.slots) {
      const subsubcategoryIds = slot.map((id) => itemById(pool, id).subsubcategoryId);
      expect(new Set(subsubcategoryIds).size).toBe(subsubcategoryIds.length);
    }
  });

  test("requested Difficulty easy/medium/hard yields only Items of that Difficulty", () => {
    const { pool, categories } = buildSingleCategoryPool();
    const picks: CategoryPick[] = new Array(SLOT_COUNT).fill(undefined);
    picks[4] = categories[0].id;

    const difficulties: Difficulty[] = ["easy", "medium", "hard"];
    for (const difficulty of difficulties) {
      const result = sampleComposition({
        request: baseRequest({
          quizMode: "single_category",
          categoryPicks: picks,
          requestedDifficulty: difficulty,
        }),
        pool,
        excludedItemIds: new Set(),
        random: createSeededRandom(1),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) continue;

      for (const slot of result.composition.slots) {
        for (const id of slot) {
          expect(itemById(pool, id).difficulty).toBe(difficulty);
        }
      }
    }
  });

  test("mixed Difficulty yields 4/3/3 per slot, with the level getting 4 varying across seeds", () => {
    const { pool, categories } = buildSingleCategoryPool();
    const picks: CategoryPick[] = new Array(SLOT_COUNT).fill(undefined);
    picks[4] = categories[0].id;

    const extraLevels = new Set<Difficulty>();

    for (let seed = 1; seed <= 15; seed++) {
      const result = sampleComposition({
        request: baseRequest({
          quizMode: "single_category",
          categoryPicks: picks,
          requestedDifficulty: "mixed",
        }),
        pool,
        excludedItemIds: new Set(),
        random: createSeededRandom(seed),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) continue;

      for (const slot of result.composition.slots) {
        const counts: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };
        const subsubcategoryIds = new Set<string>();
        for (const id of slot) {
          const item = itemById(pool, id);
          counts[item.difficulty]++;
          subsubcategoryIds.add(item.subsubcategoryId);
        }
        expect(subsubcategoryIds.size).toBe(ITEMS_PER_SLOT);
        const sortedCounts = Object.values(counts).sort((a, b) => b - a);
        expect(sortedCounts).toEqual([4, 3, 3]);

        const extraLevel = (Object.entries(counts) as [Difficulty, number][]).find(
          ([, count]) => count === 4,
        )?.[0];
        if (extraLevel) extraLevels.add(extraLevel);
      }
    }

    expect(extraLevels.size).toBeGreaterThanOrEqual(2);
  });

  test("excludedItemIds are never chosen", () => {
    // Extra headroom: 12 Subsubcategories with 6 Items each at "easy" (72
    // total), so excluding two full Subsubcategories' worth of Items still
    // leaves comfortably enough for all 6 "text" slots to each draw a fresh
    // 10 without repeating an Item already placed by an earlier slot.
    const { pool, categories } = buildPoolFixture({
      locales: ["nl"],
      categories: 1,
      subsubcategoriesPerCategory: 12,
      itemsPerKindPerDifficulty: 72,
    });

    const excluded = new Set(
      pool.filter((item) => item.kind === "text" && item.difficulty === "easy").slice(0, 2).map((i) => i.id),
    );

    const picks: CategoryPick[] = new Array(SLOT_COUNT).fill(undefined);
    picks[4] = categories[0].id;

    const result = sampleComposition({
      request: baseRequest({ quizMode: "single_category", categoryPicks: picks }),
      pool,
      excludedItemIds: excluded,
      random: createSeededRandom(3),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const slot of result.composition.slots) {
      for (const id of slot) {
        expect(excluded.has(id)).toBe(false);
      }
    }
  });

  test("Items whose locales do not include request.locale are never chosen", () => {
    // Same shape as the exclusion test: 12 Subsubcategories with 6 Items
    // each at "easy" (72 total), so removing 2 Items' "nl" translation
    // still leaves comfortably enough eligible Dutch Items for all 6
    // "text" slots.
    const { pool, categories } = buildPoolFixture({
      locales: ["nl"],
      categories: 1,
      subsubcategoriesPerCategory: 12,
      itemsPerKindPerDifficulty: 72,
    });

    const textEasy = pool.filter((item) => item.kind === "text" && item.difficulty === "easy");
    const enOnlyIds = new Set(textEasy.slice(0, 2).map((item) => item.id));
    const poolWithLocaleGap: PoolItem[] = pool.map((item) =>
      enOnlyIds.has(item.id) ? { ...item, locales: ["en"] } : item,
    );

    const picks: CategoryPick[] = new Array(SLOT_COUNT).fill(undefined);
    picks[4] = categories[0].id;

    const result = sampleComposition({
      request: baseRequest({ quizMode: "single_category", categoryPicks: picks, locale: "nl" }),
      pool: poolWithLocaleGap,
      excludedItemIds: new Set(),
      random: createSeededRandom(2),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const id of result.composition.slots[0]) {
      expect(enOnlyIds.has(id)).toBe(false);
    }
  });

  test("shortfall names the failing slot, Category, and shortfall count", () => {
    // Text and Picture have 7 Items per Subsubcategory (70 total, headroom
    // for all 6 "text" slots), but Music has been trimmed to exactly one
    // Item per remaining Subsubcategory after dropping 3 of the 10 -
    // exactly 7 eligible Music Items - so only the Music slot (7) should
    // fail, 3 short.
    const { pool: fullPool, categories } = buildPoolFixture({
      locales: ["nl"],
      categories: 1,
      subsubcategoriesPerCategory: 10,
      itemsPerKindPerDifficulty: 70,
    });

    const musicEasy = fullPool.filter((item) => item.kind === "music" && item.difficulty === "easy");
    const musicEasyIdBySubsub = new Map<string, string>();
    for (const item of musicEasy) {
      if (!musicEasyIdBySubsub.has(item.subsubcategoryId)) {
        musicEasyIdBySubsub.set(item.subsubcategoryId, item.id);
      }
    }
    const droppedSubsubcategoryIds = new Set(Array.from(musicEasyIdBySubsub.keys()).slice(0, 3));
    const keptMusicEasyIds = new Set(
      Array.from(musicEasyIdBySubsub.entries())
        .filter(([subsubcategoryId]) => !droppedSubsubcategoryIds.has(subsubcategoryId))
        .map(([, id]) => id),
    );
    const pool = fullPool.filter((item) => {
      if (item.kind !== "music" || item.difficulty !== "easy") return true;
      return keptMusicEasyIds.has(item.id);
    });

    const picks: CategoryPick[] = new Array(SLOT_COUNT).fill(undefined);
    picks[7] = categories[0].id;

    const result = sampleComposition({
      request: baseRequest({ quizMode: "single_category", categoryPicks: picks }),
      pool,
      excludedItemIds: new Set(),
      random: createSeededRandom(1),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure).toEqual({ slotIndex: 7, categoryId: categories[0].id, shortfall: 3 });
  });

  test("the same seed produces an identical Composition; a different seed generally differs", () => {
    const { pool } = buildFullPool();
    const request = baseRequest();

    const first = sampleComposition({
      request,
      pool,
      excludedItemIds: new Set(),
      random: createSeededRandom(42),
    });
    const second = sampleComposition({
      request,
      pool,
      excludedItemIds: new Set(),
      random: createSeededRandom(42),
    });
    const third = sampleComposition({
      request,
      pool,
      excludedItemIds: new Set(),
      random: createSeededRandom(43),
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(third.ok).toBe(true);
    if (!first.ok || !second.ok || !third.ok) return;

    expect(second.composition).toEqual(first.composition);
    expect(third.composition).not.toEqual(first.composition);
  });

  test("a zero-slack mixed pool still succeeds after excluding a prior mixed sample's Items", () => {
    // 8 Categories (one per slot, so Category assignment itself has zero
    // slack too), each with 10 Subsubcategories and exactly one Item per
    // (kind, Difficulty, Subsubcategory) - i.e. zero slack throughout. A
    // greedy per-level fill (easy first, then medium, then hard) can
    // exhaust the Subsubcategories a later level needed, even though a
    // valid 4/3/3 assignment exists.
    const { pool } = buildFullPool();

    let failures = 0;
    for (let seedPair = 0; seedPair < 20; seedPair++) {
      const firstSeed = seedPair * 2 + 1;
      const secondSeed = seedPair * 2 + 2;

      const first = sampleComposition({
        request: baseRequest({ requestedDifficulty: "mixed" }),
        pool,
        excludedItemIds: new Set(),
        random: createSeededRandom(firstSeed),
      });
      expect(first.ok).toBe(true);
      if (!first.ok) continue;

      const excludedItemIds = new Set(first.composition.slots.flat());

      const second = sampleComposition({
        request: baseRequest({ requestedDifficulty: "mixed" }),
        pool,
        excludedItemIds,
        random: createSeededRandom(secondSeed),
      });

      if (!second.ok) failures++;
    }

    expect(failures).toBe(0);
  });

  test("position order within a slot is randomised, not pool order", () => {
    // `mixed` mode (rather than `single_category`) so slot 0's Category is
    // exclusive to it - the other 7 slots draw distinct Categories from the
    // pool's remaining 7, decoupling this assertion from any other slot's
    // exclusions and keeping the pool-order comparison exact.
    const { pool, categories } = buildFullPool();

    const picks: CategoryPick[] = new Array(SLOT_COUNT).fill(undefined);
    picks[0] = categories[0].id;

    const poolOrderTextEasy = pool
      .filter((item) => item.kind === "text" && item.difficulty === "easy" && item.categoryId === categories[0].id)
      .map((item) => item.id);

    const result = sampleComposition({
      request: baseRequest({ categoryPicks: picks }),
      pool,
      excludedItemIds: new Set(),
      random: createSeededRandom(5),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const slot = result.composition.slots[0];
    expect(slot).toHaveLength(poolOrderTextEasy.length);
    expect(slot).not.toEqual(poolOrderTextEasy);
  });
});
