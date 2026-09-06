/**
 * Property-based tests for `maximumBipartiteMatching` (property 4's matching
 * half). See sample.property.test.ts for properties 1-3 and property 4's
 * sampler half.
 */
import * as fc from "fast-check";
import { describe, expect, test } from "vitest";
import { createSeededRandom } from "./random";
import { maximumBipartiteMatching } from "./matching";

fc.configureGlobal({ seed: 20260906, numRuns: 100 });

/**
 * Exhaustive backtracking maximum matching, only ever run on graphs bounded
 * to ~7 left nodes x ~7 right ids by the generator below.
 */
function bruteForceMaxMatching(groups: readonly (readonly string[])[]): number {
  const usedIds = new Set<string>();
  let best = 0;

  function backtrack(index: number, matched: number): void {
    if (matched + (groups.length - index) <= best) return;
    if (index === groups.length) {
      if (matched > best) best = matched;
      return;
    }
    for (const id of groups[index]) {
      if (usedIds.has(id)) continue;
      usedIds.add(id);
      backtrack(index + 1, matched + 1);
      usedIds.delete(id);
    }
    backtrack(index + 1, matched);
  }

  backtrack(0, 0);
  return best;
}

/** A small bipartite graph: 1-7 left slots, each with edges to a subset of 1-7 right ids. */
const graphArb = fc
  .integer({ min: 1, max: 7 })
  .chain((rightCount) => {
    const rightIds = Array.from({ length: rightCount }, (_, index) => `right-${index}`);
    return fc.record({
      rightIds: fc.constant(rightIds),
      slotEligibleIds: fc.array(fc.subarray(rightIds), { minLength: 1, maxLength: 7 }),
      seed: fc.integer(),
    });
  });

describe("maximumBipartiteMatching properties", () => {
  test("property 4: the matching is valid and its size equals a brute-force maximum", () => {
    fc.assert(
      fc.property(graphArb, ({ slotEligibleIds, seed }) => {
        const result = maximumBipartiteMatching(slotEligibleIds, createSeededRandom(seed));

        // Valid: only along edges, each right id used at most once.
        const usedIds = new Set<string>();
        result.assignment.forEach((id, slotIndex) => {
          if (id === undefined) return;
          expect(slotEligibleIds[slotIndex]).toContain(id);
          expect(usedIds.has(id)).toBe(false);
          usedIds.add(id);
        });

        const definedCount = result.assignment.filter((id) => id !== undefined).length;
        expect(result.matchingSize).toBe(definedCount);

        expect(result.matchingSize).toBe(bruteForceMaxMatching(slotEligibleIds));
      }),
    );
  });
});
