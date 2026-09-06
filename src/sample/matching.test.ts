import { describe, expect, test } from "vitest";
import { createSeededRandom } from "./random";
import { maximumBipartiteMatching } from "./matching";

describe("maximumBipartiteMatching", () => {
  test("finds a perfect matching that a greedy per-slot pick would miss", () => {
    // Slot 0 can only use s1. Slot 1 can use s1 or s2. A greedy fill that
    // processes slot 1 first and takes s1 (its first candidate) starves
    // slot 0, even though the assignment {slot0: s1, slot1: s2} exists.
    const slotEligibleIds = [["s1"], ["s1", "s2"]];

    // Try enough seeds that at least one would have driven a naive greedy
    // fill into the failing order, to demonstrate the matching is robust to
    // slot/candidate order rather than accidentally succeeding once.
    for (let seed = 1; seed <= 20; seed++) {
      const result = maximumBipartiteMatching(slotEligibleIds, createSeededRandom(seed));

      expect(result.matchingSize).toBe(2);
      expect(new Set(result.assignment)).toEqual(new Set(["s1", "s2"]));
    }
  });

  test("reports a genuine shortfall when no full assignment exists", () => {
    // Both slots can only use s1: at most one can be matched.
    const slotEligibleIds = [["s1"], ["s1"]];

    const result = maximumBipartiteMatching(slotEligibleIds, createSeededRandom(1));

    expect(result.matchingSize).toBe(1);
    expect(result.assignment.filter((id) => id !== undefined)).toHaveLength(1);
  });

  test("slots with no eligible ids are always unmatched", () => {
    const slotEligibleIds = [[], ["s1"]];

    const result = maximumBipartiteMatching(slotEligibleIds, createSeededRandom(1));

    expect(result.matchingSize).toBe(1);
    expect(result.assignment[0]).toBeUndefined();
    expect(result.assignment[1]).toBe("s1");
  });

  test("empty input matches nothing", () => {
    const result = maximumBipartiteMatching([], createSeededRandom(1));

    expect(result.matchingSize).toBe(0);
    expect(result.assignment).toEqual([]);
  });
});
