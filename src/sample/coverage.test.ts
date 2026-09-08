import { describe, expect, test } from "vitest";
import type { Locale, PoolItem } from "@/domain";
import { computeCoverage } from "./coverage";

/** Builds a minimal PoolItem for coverage tests; subcategoryId is unused by coverage. */
function makeItem(fields: {
  id: string;
  kind?: PoolItem["kind"];
  difficulty?: PoolItem["difficulty"];
  categoryId: string;
  subsubcategoryId: string;
  locales?: readonly Locale[];
}): PoolItem {
  return {
    id: fields.id,
    kind: fields.kind ?? "text",
    difficulty: fields.difficulty ?? "easy",
    categoryId: fields.categoryId,
    subcategoryId: fields.categoryId,
    subsubcategoryId: fields.subsubcategoryId,
    locales: fields.locales ?? ["nl"],
  };
}

/** 10 text/easy Items in `cat`, one per Subsubcategory ("sub-0".."sub-9"). */
function buildTenByTenPool(): PoolItem[] {
  return Array.from({ length: 10 }, (_, i) =>
    makeItem({ id: `item-${i}`, categoryId: "cat", subsubcategoryId: `sub-${i}` }),
  );
}

function cellFor(
  cells: ReturnType<typeof computeCoverage>,
  categoryId: string,
  kind: PoolItem["kind"],
  requestedDifficulty: string,
  locale: Locale,
) {
  const cell = cells.find(
    (c) =>
      c.categoryId === categoryId &&
      c.kind === kind &&
      c.requestedDifficulty === requestedDifficulty &&
      c.locale === locale,
  );
  if (!cell) throw new Error("test setup error: no matching coverage cell");
  return cell;
}

describe("computeCoverage", () => {
  test("10 Items in 10 Subsubcategories fits a Round", () => {
    const pool = buildTenByTenPool();
    const cells = computeCoverage(pool);
    const cell = cellFor(cells, "cat", "text", "easy", "nl");
    expect(cell.eligibleItems).toBe(10);
    expect(cell.subsubcategories).toBe(10);
    expect(cell.fits).toBe(true);
  });

  test("10 Items in 9 Subsubcategories does not fit", () => {
    // Same 10 Items, but the last one shares a Subsubcategory with the first.
    const pool = buildTenByTenPool().map((item, i) =>
      i === 9 ? { ...item, subsubcategoryId: "sub-0" } : item,
    );
    const cells = computeCoverage(pool);
    const cell = cellFor(cells, "cat", "text", "easy", "nl");
    expect(cell.eligibleItems).toBe(10);
    expect(cell.subsubcategories).toBe(9);
    expect(cell.fits).toBe(false);
  });

  test("excluded ids reduce eligibleItems and can flip fits", () => {
    const pool = buildTenByTenPool();
    const excluded = new Set(["item-9"]);
    const cells = computeCoverage(pool, excluded);
    const cell = cellFor(cells, "cat", "text", "easy", "nl");
    expect(cell.eligibleItems).toBe(9);
    expect(cell.subsubcategories).toBe(9);
    expect(cell.fits).toBe(false);
  });

  test("an Item without the Locale's Translation is not counted", () => {
    const pool = buildTenByTenPool().map((item, i) =>
      i === 9 ? { ...item, locales: ["en"] as const } : item,
    );
    const cells = computeCoverage(pool);
    const nl = cellFor(cells, "cat", "text", "easy", "nl");
    expect(nl.eligibleItems).toBe(9);
    expect(nl.subsubcategories).toBe(9);
    expect(nl.fits).toBe(false);

    const en = cellFor(cells, "cat", "text", "easy", "en");
    expect(en.eligibleItems).toBe(1);
    expect(en.subsubcategories).toBe(1);
    expect(en.fits).toBe(false);
  });

  test("mixed 4/3/3 fits with 10 Subsubcategories covering all three Difficulties", () => {
    const pool: PoolItem[] = [];
    for (let i = 0; i < 10; i++) {
      for (const difficulty of ["easy", "medium", "hard"] as const) {
        pool.push(
          makeItem({
            id: `item-${i}-${difficulty}`,
            difficulty,
            categoryId: "cat",
            subsubcategoryId: `sub-${i}`,
          }),
        );
      }
    }
    const cells = computeCoverage(pool);
    const cell = cellFor(cells, "cat", "text", "mixed", "nl");
    expect(cell.eligibleItems).toBe(30);
    expect(cell.subsubcategories).toBe(10);
    expect(cell.fits).toBe(true);
  });

  test("mixed does not fit with only 9 Subsubcategories covering all three Difficulties", () => {
    const pool: PoolItem[] = [];
    for (let i = 0; i < 9; i++) {
      for (const difficulty of ["easy", "medium", "hard"] as const) {
        pool.push(
          makeItem({
            id: `item-${i}-${difficulty}`,
            difficulty,
            categoryId: "cat",
            subsubcategoryId: `sub-${i}`,
          }),
        );
      }
    }
    const cells = computeCoverage(pool);
    const cell = cellFor(cells, "cat", "text", "mixed", "nl");
    expect(cell.eligibleItems).toBe(27);
    expect(cell.subsubcategories).toBe(9);
    expect(cell.fits).toBe(false);
  });

  test("one cell per (Category present in the pool) x kind x requestedDifficulty x locale, sorted", () => {
    const pool: PoolItem[] = [
      makeItem({ id: "a", categoryId: "cat-b", kind: "picture", subsubcategoryId: "sub-b-0" }),
      makeItem({ id: "b", categoryId: "cat-a", kind: "text", subsubcategoryId: "sub-a-0" }),
    ];
    const cells = computeCoverage(pool);

    // 2 Categories x 3 kinds x 4 Difficulties x 2 Locales.
    expect(cells).toHaveLength(2 * 3 * 4 * 2);

    // categoryId asc, then kind in SLOT_KINDS order (text, picture, music),
    // then Difficulty (easy, medium, hard, mixed), then locale (nl, en).
    const expectedOrder = cells.map((c) => `${c.categoryId}|${c.kind}|${c.requestedDifficulty}|${c.locale}`);
    const sortedCopy = [...expectedOrder].sort((left, right) => {
      const [catL] = left.split("|");
      const [catR] = right.split("|");
      return catL < catR ? -1 : catL > catR ? 1 : 0;
    });
    // categoryId blocks must already be in ascending order (cat-a before cat-b).
    expect(expectedOrder[0].startsWith("cat-a|")).toBe(true);
    expect(expectedOrder[expectedOrder.length - 1].startsWith("cat-b|")).toBe(true);
    void sortedCopy;

    const kindsForCatA = cells.filter((c) => c.categoryId === "cat-a").map((c) => c.kind);
    // 4 Difficulties x 2 Locales = 8 cells per kind.
    expect(kindsForCatA.slice(0, 8)).toEqual(Array(8).fill("text"));
    expect(kindsForCatA.slice(8, 16)).toEqual(Array(8).fill("picture"));
    expect(kindsForCatA.slice(16, 24)).toEqual(Array(8).fill("music"));

    const difficultiesForFirstKind = cells
      .filter((c) => c.categoryId === "cat-a" && c.kind === "text")
      .map((c) => c.requestedDifficulty);
    // 2 Locales per Difficulty.
    expect(difficultiesForFirstKind).toEqual([
      "easy",
      "easy",
      "medium",
      "medium",
      "hard",
      "hard",
      "mixed",
      "mixed",
    ]);

    const localesForFirstCell = cells
      .filter((c) => c.categoryId === "cat-a" && c.kind === "text" && c.requestedDifficulty === "easy")
      .map((c) => c.locale);
    expect(localesForFirstCell).toEqual(["nl", "en"]);
  });
});
