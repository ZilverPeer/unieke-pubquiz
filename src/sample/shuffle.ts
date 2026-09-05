/**
 * Random-source-driven helpers shared by the sampling algorithm. Private to
 * src/sample; not part of the public seam.
 */
import type { RandomSource } from "./random";

/** Fisher-Yates shuffle, driven by `random`. Mutates and returns `items`. */
export function shuffleInPlace<T>(items: T[], random: RandomSource): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random.next() * (i + 1));
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}

/** Picks a random index in [0, length) using `random`. */
export function pickIndex(length: number, random: RandomSource): number {
  return Math.floor(random.next() * length);
}
