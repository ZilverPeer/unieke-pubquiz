/**
 * Pure orchestration for POST /api/feasibility (ticket #102, spec 5; cart
 * order carried through since ticket #121): answers each line of a parsed
 * request in cart order, given the pool/exclusion loaders and the Category
 * id set as plain functions/data (not a ContentRepository), so route.ts
 * stays a thin wiring layer and this module's own tests (via the
 * integration test, which drives it through the route -- see README.md)
 * can call it directly too.
 *
 * A line's verdict depends on the lines before it in the same request: the
 * worker generates a multi-Quiz order line by line, each Composition
 * excluding the previous ones, so the check walks the cart the same way. It
 * keeps one growing exclusion set, seeded from `loadExcludedItemIds`; for
 * each valid line it seed-samples a full Composition with
 * `sampleComposition` (a stand-in for the real, differently-seeded sample
 * generation would use -- only the counts it consumes matter here, not
 * which Items it picks) and, on success, adds every one of its Item ids to
 * the exclusion set before moving on, so the next line sees this line's
 * consumption. On failure the line reports the shortfalls `dryRunRequest`
 * would give for the same exclusion set (the full list, every short slot,
 * not just the first -- see src/sample/README.md "Coverage and dry runs")
 * and nothing is added to the exclusion set for it, so a failed line never
 * costs the line after it anything.
 *
 * Loads the pool once per distinct Locale used by the request's lines
 * (cached locally) and the billing email's excluded Item ids once for the
 * whole request -- every line shares the same billingEmail, so there is
 * only ever one exclusion set to load (then grown line by line).
 */
import type { Locale, PoolItem, QuizRequest } from "@/domain";
import { SLOT_COUNT } from "@/domain";
import { createSeededRandom, dryRunRequest, sampleComposition, type DryRunShortfall } from "@/sample";
import type { ParsedFeasibilityLine, ParsedFeasibilityRequest } from "./parse-request";

/**
 * Any constant seed, applied fresh per line: a stand-in sample only needs
 * to consume the right counts, not reproduce what the worker would
 * actually generate.
 */
const FEASIBILITY_SEED = 0;

export interface CheckFeasibilityDeps {
  loadPool(locale: Locale): Promise<readonly { item: PoolItem }[]>;
  loadExcludedItemIds(billingEmail: string): Promise<ReadonlySet<string>>;
  /** Every existing Category id (createCategoryIdLookup, src/repository/index.ts), loaded once per request by the caller. */
  categoryIds: ReadonlySet<string>;
}

export interface FeasibilityLineResult {
  feasible: boolean;
  invalid: string | null;
  shortfalls: DryRunShortfall[];
}

export interface FeasibilityResult {
  lines: FeasibilityLineResult[];
}

/**
 * An invalid reason for the line, or null when the picks are well-formed:
 * an unknown Category id, more than SLOT_COUNT picks, or a duplicate pick.
 */
function validateLine(line: ParsedFeasibilityLine, categoryIds: ReadonlySet<string>): string | null {
  if (line.categoryPicks.length > SLOT_COUNT) {
    return `too many category picks: ${line.categoryPicks.length} (max ${SLOT_COUNT})`;
  }

  const seen = new Set<string>();
  for (const categoryId of line.categoryPicks) {
    if (seen.has(categoryId)) return `duplicate category ${categoryId}`;
    seen.add(categoryId);
  }
  for (const categoryId of line.categoryPicks) {
    if (!categoryIds.has(categoryId)) return `unknown category ${categoryId}`;
  }

  return null;
}

export async function checkFeasibility(
  parsed: ParsedFeasibilityRequest,
  deps: CheckFeasibilityDeps,
): Promise<FeasibilityResult> {
  const { billingEmail, lines } = parsed;
  const { loadPool, loadExcludedItemIds, categoryIds } = deps;

  // Grows as each feasible line's Item ids are added, in cart order -- see
  // the module doc comment above.
  const excludedItemIds = new Set<string>(await loadExcludedItemIds(billingEmail));
  const poolByLocale = new Map<Locale, readonly PoolItem[]>();

  async function poolFor(locale: Locale): Promise<readonly PoolItem[]> {
    const cached = poolByLocale.get(locale);
    if (cached) return cached;
    const entries = await loadPool(locale);
    const pool = entries.map((entry) => entry.item);
    poolByLocale.set(locale, pool);
    return pool;
  }

  const results: FeasibilityLineResult[] = [];
  for (const line of lines) {
    const invalid = validateLine(line, categoryIds);
    if (invalid) {
      results.push({ feasible: false, invalid, shortfalls: [] });
      continue;
    }

    const pool = await poolFor(line.locale);
    const request: QuizRequest = {
      locale: line.locale,
      categoryPicks: line.categoryPicks,
      requestedDifficulty: line.requestedDifficulty,
      billingEmail,
    };

    const sampled = sampleComposition({
      request,
      pool,
      excludedItemIds,
      random: createSeededRandom(FEASIBILITY_SEED),
    });

    if (sampled.ok) {
      for (const slot of sampled.composition.slots) {
        for (const itemId of slot) excludedItemIds.add(itemId);
      }
      results.push({ feasible: true, invalid: null, shortfalls: [] });
      continue;
    }

    // Report the full shortfall list (every short slot, not just the one
    // sampleComposition happened to stop on) for the same exclusion set,
    // so the shop's notice still names every short Category. Nothing is
    // added to excludedItemIds for a failed line.
    const shortfalls = dryRunRequest({
      request,
      pool,
      excludedItemIds,
      random: createSeededRandom(FEASIBILITY_SEED),
    });
    results.push({ feasible: false, invalid: null, shortfalls });
  }

  return { lines: results };
}
