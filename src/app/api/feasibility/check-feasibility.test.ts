/**
 * Unit tests for checkFeasibility's cart-order carry-through (ticket #121,
 * spec 5 #98): lines of the same order are generated in cart order, each
 * consuming Items the next one can no longer use (the worker generates a
 * multi-Quiz order line by line, each Composition excluding the previous
 * ones). A synthetic pool with stub loaders, pure -- no I/O, no stack.
 */
import { describe, expect, it } from "vitest";
import type { Locale, PoolItem } from "@/domain";
import { checkFeasibility, type CheckFeasibilityDeps } from "./check-feasibility";
import type { ParsedFeasibilityLine, ParsedFeasibilityRequest } from "./parse-request";

const CATEGORY_ID = "catA";
const SUBSUBCATEGORY_COUNT = 10;

function makeItems(
  kindPrefix: string,
  kind: PoolItem["kind"],
  count: number,
  locale: Locale = "nl",
): PoolItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${kindPrefix}-${i}`,
    kind,
    difficulty: "easy",
    categoryId: CATEGORY_ID,
    subcategoryId: CATEGORY_ID,
    subsubcategoryId: `sub-${i % SUBSUBCATEGORY_COUNT}`,
    locales: [locale],
  }));
}

/**
 * 6 text slots x ITEMS_PER_SLOT(10) = 60 needed per Composition; 70 text
 * Items (7 per Subsubcategory, 10 Subsubcategories) leaves exactly 10 spare
 * after one Composition -- a second identical line then has only 10 left
 * against a 60 need, a shortfall of 60 - 10 = 50 (the first line's
 * consumption minus the spare). Picture and music get 20 Items each (2 per
 * Subsubcategory) -- exactly enough for two Compositions' 1 slot of 10
 * each, so they never fall short and the shortfall is text-only and easy to
 * predict.
 */
function buildPool(): PoolItem[] {
  return [
    ...makeItems("text", "text", 70),
    ...makeItems("picture", "picture", 20),
    ...makeItems("music", "music", 20),
  ];
}

function line(overrides: Partial<ParsedFeasibilityLine> = {}): ParsedFeasibilityLine {
  return {
    locale: "nl",
    requestedDifficulty: "easy",
    categoryPicks: [CATEGORY_ID],
    ...overrides,
  };
}

function buildDeps(pool: PoolItem[]): CheckFeasibilityDeps {
  return {
    loadPool: async () => pool.map((item) => ({ item })),
    loadExcludedItemIds: async () => new Set<string>(),
    categoryIds: new Set([CATEGORY_ID]),
  };
}

function totalShortfall(shortfalls: { shortfall: number }[]): number {
  return shortfalls.reduce((sum, s) => sum + s.shortfall, 0);
}

describe("checkFeasibility (cart order)", () => {
  it("answers two lines, each feasible alone against the pool, as feasible then short together", async () => {
    const pool = buildPool();
    const request: ParsedFeasibilityRequest = {
      billingEmail: "player@example.com",
      lines: [line(), line()],
    };

    const result = await checkFeasibility(request, buildDeps(pool));

    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].feasible).toBe(true);
    // This is the red assertion: today every line is dry-run independently
    // against the same exclusion set, so the second line also comes back
    // feasible: true here even though the pool cannot fill both.
    expect(result.lines[1].feasible).toBe(false);
    expect(totalShortfall(result.lines[1].shortfalls)).toBe(50);
  });

  it("flips which line fails when the same two lines are reordered", async () => {
    const pool = buildPool();
    const lineA = line();
    const lineB = line();

    const forward = await checkFeasibility(
      { billingEmail: "player@example.com", lines: [lineA, lineB] },
      buildDeps(pool),
    );
    const reversed = await checkFeasibility(
      { billingEmail: "player@example.com", lines: [lineB, lineA] },
      buildDeps(buildPool()),
    );

    expect(forward.lines[0].feasible).toBe(true);
    expect(forward.lines[1].feasible).toBe(false);
    expect(reversed.lines[0].feasible).toBe(true);
    expect(reversed.lines[1].feasible).toBe(false);
  });

  it("does not let a failed line reduce the pool for the line after it", async () => {
    const pool = buildPool();
    const request: ParsedFeasibilityRequest = {
      billingEmail: "player@example.com",
      lines: [line(), line(), line()],
    };

    const result = await checkFeasibility(request, buildDeps(pool));

    expect(result.lines[0].feasible).toBe(true);
    expect(result.lines[1].feasible).toBe(false);
    expect(result.lines[2].feasible).toBe(false);
    // Line 2 failed and consumed nothing, so line 3 sees the exact same
    // exclusion set line 2 did -- same shortfalls, not worse.
    expect(result.lines[2].shortfalls).toEqual(result.lines[1].shortfalls);
  });

  it("skips an invalid line without consuming anything", async () => {
    const pool = buildPool();
    const request: ParsedFeasibilityRequest = {
      billingEmail: "player@example.com",
      lines: [line({ categoryPicks: ["unknown-category"] }), line(), line()],
    };

    const result = await checkFeasibility(request, buildDeps(pool));

    expect(result.lines[0].feasible).toBe(false);
    expect(result.lines[0].invalid).not.toBeNull();
    // Same outcome as the two-line case above: the invalid first line must
    // not have consumed anything from the pool.
    expect(result.lines[1].feasible).toBe(true);
    expect(result.lines[2].feasible).toBe(false);
    expect(totalShortfall(result.lines[2].shortfalls)).toBe(50);
  });
});
