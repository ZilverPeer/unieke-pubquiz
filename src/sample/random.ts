/**
 * The seeded random source used throughout sampling. Its own module so
 * `slots.ts` and `shuffle.ts` can depend on it without a circular import
 * through `index.ts`.
 */

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
