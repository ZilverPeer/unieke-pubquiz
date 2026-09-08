/**
 * Coverage page data: loads the live pool for one data Locale and groups the
 * sampler's own `computeCoverage` cells per Category into rows of kind x
 * requested Difficulty. Read-only -- no repository write module, this is the
 * page's only server-side seam (ticket #92).
 */
import type { ItemKind, Locale, RequestedDifficulty } from "@/domain";
import { SLOT_KINDS } from "@/domain";
import { createRepository, resolveLocalStackConfig } from "@/repository";
import { computeCoverage } from "@/sample";

// SLOT_KINDS repeats "text" six times (one per text Round slot); the unique
// kinds, in their first-appearance order, are the coverage table's rows.
const KINDS: readonly ItemKind[] = Array.from(new Set(SLOT_KINDS));
const REQUESTED_DIFFICULTIES: readonly RequestedDifficulty[] = ["easy", "medium", "hard", "mixed"];

export interface CoverageCellView {
  eligibleItems: number;
  subsubcategories: number;
  fits: boolean;
}

export interface CoverageRow {
  kind: ItemKind;
  cells: Record<RequestedDifficulty, CoverageCellView>;
}

export interface CoverageCategory {
  categoryId: string;
  categoryName: string;
  rows: CoverageRow[];
}

/**
 * Loads the pool for `locale` (so eligibility matches exactly what the
 * sampler would see for a request in that Locale) and groups the resulting
 * coverage cells by Category, sorted by Category name. `computeCoverage`
 * always returns cells for both Locales; only the cells matching `locale`
 * are used here -- the pool itself was already loaded for that one Locale,
 * so the other Locale's cells would undercount (see `loadPool`, which only
 * includes Items with a translation for the requested Locale).
 */
export async function loadCoverage(locale: Locale): Promise<CoverageCategory[]> {
  const repository = createRepository(resolveLocalStackConfig());
  const pool = await repository.loadPool(locale);

  const categoryNameById = new Map<string, string>();
  for (const entry of pool) {
    categoryNameById.set(entry.item.categoryId, entry.categoryName);
  }

  const cells = computeCoverage(pool.map((entry) => entry.item)).filter((cell) => cell.locale === locale);

  const categoryIds = Array.from(categoryNameById.keys()).sort((a, b) =>
    (categoryNameById.get(a) ?? "").localeCompare(categoryNameById.get(b) ?? "", locale),
  );

  return categoryIds.map((categoryId) => {
    const categoryCells = cells.filter((cell) => cell.categoryId === categoryId);

    const rows: CoverageRow[] = KINDS.map((kind) => {
      const kindCells = categoryCells.filter((cell) => cell.kind === kind);
      const cellsByDifficulty = Object.fromEntries(
        REQUESTED_DIFFICULTIES.map((requestedDifficulty) => {
          const cell = kindCells.find((c) => c.requestedDifficulty === requestedDifficulty);
          const view: CoverageCellView = {
            eligibleItems: cell?.eligibleItems ?? 0,
            subsubcategories: cell?.subsubcategories ?? 0,
            fits: cell?.fits ?? false,
          };
          return [requestedDifficulty, view];
        }),
      ) as Record<RequestedDifficulty, CoverageCellView>;

      return { kind, cells: cellsByDifficulty };
    });

    return {
      categoryId,
      categoryName: categoryNameById.get(categoryId) ?? "",
      rows,
    };
  });
}
