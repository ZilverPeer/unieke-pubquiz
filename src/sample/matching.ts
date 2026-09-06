/**
 * Generic maximum bipartite matching (Kuhn's algorithm with augmenting
 * paths) between a list of "slots" (left side, referenced by index) and a
 * set of string ids (right side). Used by `slots.ts` to assign quota slots
 * (one requested Item per Difficulty level) to Subsubcategories, so a slot
 * is only reported unmatched when no valid assignment exists at all - never
 * because an earlier, unrelated slot greedily took the only candidate a
 * later slot needed.
 *
 * Pure; no domain imports. Private to src/sample.
 */
import { shuffleInPlace } from "./shuffle";
import type { RandomSource } from "./random";

export interface MatchingResult {
  /** Matched id per slot index, or undefined where the slot is unmatched. */
  assignment: (string | undefined)[];
  /** Number of slots that received a match. */
  matchingSize: number;
}

/**
 * Finds a maximum matching between slot indices `0..slotEligibleIds.length`
 * and the ids in `slotEligibleIds[slotIndex]`, i.e. an assignment of at most
 * one id per slot, each id used by at most one slot, maximising the number
 * of matched slots. `random` shuffles both the candidate id order and the
 * order slots are processed in, so different seeds can yield different
 * (equally maximal) assignments.
 */
export function maximumBipartiteMatching(
  slotEligibleIds: readonly (readonly string[])[],
  random: RandomSource,
): MatchingResult {
  const slotCount = slotEligibleIds.length;

  const allIds = Array.from(new Set(slotEligibleIds.flat()));
  const shuffledIds = shuffleInPlace(allIds, random);
  const idRank = new Map(shuffledIds.map((id, index) => [id, index]));

  const adjacency = slotEligibleIds.map((ids) =>
    ids.slice().sort((a, b) => idRank.get(a)! - idRank.get(b)!),
  );

  const slotOrder = shuffleInPlace(
    Array.from({ length: slotCount }, (_, index) => index),
    random,
  );

  // Which slot (if any) currently holds each id.
  const idToSlot = new Map<string, number>();
  const assignment: (string | undefined)[] = new Array(slotCount).fill(undefined);

  function tryAugment(slot: number, visitedIds: Set<string>): boolean {
    for (const id of adjacency[slot]) {
      if (visitedIds.has(id)) continue;
      visitedIds.add(id);

      const holder = idToSlot.get(id);
      if (holder === undefined || tryAugment(holder, visitedIds)) {
        idToSlot.set(id, slot);
        assignment[slot] = id;
        return true;
      }
    }
    return false;
  }

  let matchingSize = 0;
  for (const slot of slotOrder) {
    if (tryAugment(slot, new Set())) {
      matchingSize++;
    }
  }

  return { assignment, matchingSize };
}
