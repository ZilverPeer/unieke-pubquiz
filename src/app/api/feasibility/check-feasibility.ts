/**
 * Pure orchestration for POST /api/feasibility (ticket #102, spec 5):
 * answers every line of a parsed request independently, given the pool/
 * exclusion loaders and the Category id set as plain functions/data (not
 * a ContentRepository), so route.ts stays a thin wiring layer and this
 * module's own tests (via the integration test, which drives it through
 * the route -- see README.md) can call it directly too.
 *
 * Loads the pool once per distinct Locale used by the request's lines
 * (cached locally) and the billing email's excluded Item ids once for the
 * whole request -- every line shares the same billingEmail, so there is
 * only ever one exclusion set to load. Dry-runs with a fixed seed: the
 * point is the shortfall list, not a random sample (src/sample/README.md
 * "Coverage and dry runs").
 */
import type { Locale, PoolItem, QuizRequest } from "@/domain";
import { SLOT_COUNT } from "@/domain";
import { createSeededRandom, dryRunRequest, type DryRunShortfall } from "@/sample";
import type { ParsedFeasibilityLine, ParsedFeasibilityRequest } from "./parse-request";

/** Any constant seed: dryRunRequest's job here is the shortfall list, not a random sample. */
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

  const excludedItemIds = await loadExcludedItemIds(billingEmail);
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
    const shortfalls = dryRunRequest({
      request,
      pool,
      excludedItemIds,
      random: createSeededRandom(FEASIBILITY_SEED),
    });

    results.push({ feasible: shortfalls.length === 0, invalid: null, shortfalls });
  }

  return { lines: results };
}
