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

  test("single_category mode uses one Category for all 8 slots", () => {
    const { pool, categories } = buildFullPool();
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
    // 10 Subsubcategories with 3 Items each at "easy" so the fill has to
    // choose among several candidates per Subsubcategory.
    const { pool, categories } = buildPoolFixture({
      locales: ["nl"],
      categories: 1,
      subsubcategoriesPerCategory: 10,
      itemsPerKindPerDifficulty: 30,
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
    const { pool, categories } = buildFullPool();
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
    const { pool, categories } = buildFullPool();
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
    // Extra headroom: 12 Subsubcategories for 10 needed slots, so excluding
    // two full Subsubcategories' worth of Items still leaves 10 available.
    const { pool, categories } = buildPoolFixture({
      locales: ["nl"],
      categories: 1,
      subsubcategoriesPerCategory: 12,
      itemsPerKindPerDifficulty: 12,
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
    // Same shape as the exclusion test: 12 Subsubcategories of headroom for
    // 10 needed Items, so removing 2 Items' "nl" translation still leaves 10
    // eligible for a Dutch request.
    const { pool, categories } = buildPoolFixture({
      locales: ["nl"],
      categories: 1,
      subsubcategoriesPerCategory: 12,
      itemsPerKindPerDifficulty: 12,
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
    // Text and Picture have the full 10 eligible Subsubcategories, but Music
    // (slot 7) has been trimmed to exactly 7, so only it should fail, 3 short.
    const { pool: fullPool, categories } = buildPoolFixture({
      locales: ["nl"],
      categories: 1,
      subsubcategoriesPerCategory: 10,
      itemsPerKindPerDifficulty: 10,
    });

    const musicEasy = fullPool.filter((item) => item.kind === "music" && item.difficulty === "easy");
    const droppedSubsubcategoryIds = new Set(musicEasy.slice(0, 3).map((item) => item.subsubcategoryId));
    const pool = fullPool.filter(
      (item) =>
        !(
          item.kind === "music" &&
          item.difficulty === "easy" &&
          droppedSubsubcategoryIds.has(item.subsubcategoryId)
        ),
    );

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

  test("position order within a slot is randomised, not pool order", () => {
    const { pool, categories } = buildPoolFixture({
      locales: ["nl"],
      categories: 1,
      subsubcategoriesPerCategory: 10,
      itemsPerKindPerDifficulty: 10,
    });

    const picks: CategoryPick[] = new Array(SLOT_COUNT).fill(undefined);
    picks[4] = categories[0].id;

    const poolOrderTextEasy = pool
      .filter((item) => item.kind === "text" && item.difficulty === "easy")
      .map((item) => item.id);

    const result = sampleComposition({
      request: baseRequest({ quizMode: "single_category", categoryPicks: picks }),
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
