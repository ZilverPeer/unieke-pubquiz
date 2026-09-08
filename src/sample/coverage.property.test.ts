/**
 * Property-based tests for `computeCoverage` and `dryRunRequest`, in the
 * style of `sample.property.test.ts`.
 */
import * as fc from "fast-check";
import { describe, expect, test } from "vitest";
import type { Locale, QuizRequest, RequestedDifficulty } from "@/domain";
import { SLOT_KINDS } from "@/domain";
import { buildPoolFixture } from "@/domain/fixtures";
import { createSeededRandom, sampleComposition } from "./index";
import { computeCoverage, dryRunRequest } from "./coverage";

fc.configureGlobal({ seed: 20260908, numRuns: 100 });

const REQUESTED_DIFFICULTIES: readonly RequestedDifficulty[] = ["easy", "medium", "hard", "mixed"];
const KINDS_USED = Array.from(new Set(SLOT_KINDS));

/**
 * A single Category, symmetric across kind and Difficulty (buildPoolFixture
 * gives every (kind, Difficulty) combination the same Item count and
 * round-robins Items evenly over the built Subsubcategories), so a mixed
 * request's three possible 4/3/3 extra placements are equally feasible -
 * required for the "success implies fits" property below to hold for mixed
 * requests too, since coverage's `fits` demands all three placements while
 * `sampleComposition` only ever draws one of them.
 */
interface World {
  subsubcategoriesPerCategory: number;
  itemsPerKindPerDifficulty: number;
  requestedDifficulty: RequestedDifficulty;
  locale: Locale;
  seed: number;
}

const worldArb: fc.Arbitrary<World> = fc.record({
  subsubcategoriesPerCategory: fc.integer({ min: 10, max: 20 }),
  itemsPerKindPerDifficulty: fc.integer({ min: 20, max: 60 }),
  requestedDifficulty: fc.constantFrom(...REQUESTED_DIFFICULTIES),
  locale: fc.constantFrom<Locale>("nl", "en"),
  seed: fc.integer(),
});

function buildScenario(world: World) {
  const { pool, categories } = buildPoolFixture({
    locales: [world.locale],
    categories: 1,
    subsubcategoriesPerCategory: world.subsubcategoriesPerCategory,
    itemsPerKindPerDifficulty: world.itemsPerKindPerDifficulty,
  });
  const categoryId = categories[0].id;
  const request: QuizRequest = {
    locale: world.locale,
    categoryPicks: [categoryId],
    requestedDifficulty: world.requestedDifficulty,
    billingEmail: "player@example.com",
  };
  return { pool, categoryId, request };
}

describe("computeCoverage properties", () => {
  test("fits agrees with sampleComposition succeeding for a single-Category request", () => {
    // Only the "success implies fits" direction is asserted: sampleComposition
    // fills every slot in slot order with a growing exclusion set (later
    // "text" slots exclude Items already placed by earlier ones), so a slot
    // that succeeded there was, at worst, more constrained than coverage's
    // single fillSlot check (base exclusions only) - removing exclusions can
    // only grow the matching, so if the more-constrained call reached a full
    // match, the less-constrained one must too. The converse does not hold in
    // general (a later slot can fail only because an earlier slot already
    // used up a Subsubcategory it needed), so it is not asserted here.
    let successCount = 0;
    fc.assert(
      fc.property(worldArb, (world) => {
        const { pool, categoryId, request } = buildScenario(world);
        const result = sampleComposition({
          request,
          pool,
          excludedItemIds: new Set(),
          random: createSeededRandom(world.seed),
        });
        if (!result.ok) return;
        successCount++;

        const cells = computeCoverage(pool);
        for (const kind of KINDS_USED) {
          const cell = cells.find(
            (c) =>
              c.categoryId === categoryId &&
              c.kind === kind &&
              c.requestedDifficulty === request.requestedDifficulty &&
              c.locale === request.locale,
          );
          expect(cell?.fits).toBe(true);
        }
      }),
    );
    expect(successCount).toBeGreaterThanOrEqual(10);
  });
});

describe("dryRunRequest properties", () => {
  test("first shortfall equals sampleComposition's failure; empty when it succeeds", () => {
    let successCount = 0;
    fc.assert(
      fc.property(worldArb, (world) => {
        const { pool, request } = buildScenario(world);

        const sampleResult = sampleComposition({
          request,
          pool,
          excludedItemIds: new Set(),
          random: createSeededRandom(world.seed),
        });
        const shortfalls = dryRunRequest({
          request,
          pool,
          excludedItemIds: new Set(),
          random: createSeededRandom(world.seed),
        });

        if (sampleResult.ok) {
          successCount++;
          expect(shortfalls).toEqual([]);
        } else {
          expect(shortfalls[0]).toEqual({
            slotIndex: sampleResult.failure.slotIndex,
            kind: SLOT_KINDS[sampleResult.failure.slotIndex],
            categoryId: sampleResult.failure.categoryId,
            requestedDifficulty: request.requestedDifficulty,
            shortfall: sampleResult.failure.shortfall,
          });
        }
      }),
    );
    expect(successCount).toBeGreaterThanOrEqual(10);
  });
});
