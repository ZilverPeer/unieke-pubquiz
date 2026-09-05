/**
 * Sampling: Items -> Composition. Pure, no I/O. Imports only src/domain.
 * Interface fixed by the orchestrator for spec #1; behaviour lands in ticket #5.
 */
import type { Composition, GenerationFailure, PoolItem, QuizRequest } from "@/domain";

/** A deterministic random source: `next()` returns a float in [0, 1). */
export interface RandomSource {
  next(): number;
}

/** Seeded PRNG (mulberry32) so the same seed always yields the same Composition. */
export function createSeededRandom(seed: number): RandomSource {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

export interface SampleInput {
  request: QuizRequest;
  pool: readonly PoolItem[];
  /** Item ids already delivered to this billing email (the no-repeat rule). */
  excludedItemIds: ReadonlySet<string>;
  random: RandomSource;
}

export type SampleResult =
  | { ok: true; composition: Composition }
  | { ok: false; failure: GenerationFailure };

/**
 * Samples a Composition for the request from the pool, or returns the first
 * GenerationFailure. In `single_category` mode the Category is the first
 * defined entry of `request.categoryPicks`; in `mixed` mode unassigned slots
 * are filled from Categories present in the pool that no other slot uses.
 */
export function sampleComposition(_input: SampleInput): SampleResult {
  throw new Error("sampleComposition is implemented in ticket #5");
}
