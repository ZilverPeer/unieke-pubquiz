/**
 * Integration test for the Coverage page's data function (ticket #92). Runs
 * against the real local Supabase stack -- migrations and seed applied,
 * never mocked. See src/repository/README.md for the run sequence.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";
import { resolveLocalStackConfig } from "@/repository";
import type { Database } from "@/repository/database.types";
import { loadCoverage } from "./data";

const LOCALES = ["nl", "en"] as const;
const DIFFICULTIES = ["easy", "medium", "hard", "mixed"] as const;

const config = resolveLocalStackConfig();
const db: SupabaseClient<Database> = createClient(config.url, config.serviceRoleKey);

// This suite is the one place an integration test touches seeded rows
// (admin-common.md): it archives seeded hard text Items of one
// Subsubcategory to prove a coverage cell reports no fit, then restores
// `archived_at` to null on exactly those ids -- never a wider reset.
let archivedItemIds: string[] = [];

afterEach(async () => {
  if (archivedItemIds.length === 0) return;
  const ids = archivedItemIds;
  archivedItemIds = [];
  const { error } = await db.from("items").update({ archived_at: null }).in("id", ids);
  if (error) throw error;
});

describe("loadCoverage", () => {
  it("has every seeded Category fit text at every requested Difficulty, in both Locales", async () => {
    for (const locale of LOCALES) {
      const categories = await loadCoverage(locale);
      expect(categories.length).toBeGreaterThan(0);

      for (const category of categories) {
        const textRow = category.rows.find((row) => row.kind === "text");
        expect(textRow).toBeDefined();
        for (const difficulty of DIFFICULTIES) {
          expect(
            textRow!.cells[difficulty].fits,
            `expected text/${difficulty} to fit for Category ${category.categoryId} (${locale})`,
          ).toBe(true);
        }
      }
    }
  });

  it("reports hard text as not fitting once a Subsubcategory's seeded hard text Items are archived", async () => {
    const { data: categories, error: categoriesError } = await db.from("categories").select("id").limit(1);
    if (categoriesError) throw categoriesError;
    const categoryId = categories[0].id;

    const { data: subcategories, error: subcategoriesError } = await db
      .from("subcategories")
      .select("id")
      .eq("category_id", categoryId);
    if (subcategoriesError) throw subcategoriesError;
    const subcategoryIds = subcategories.map((row) => row.id);

    const { data: subsubcategories, error: subsubcategoriesError } = await db
      .from("subsubcategories")
      .select("id")
      .in("subcategory_id", subcategoryIds);
    if (subsubcategoriesError) throw subsubcategoriesError;

    // Pick the first Subsubcategory of this Category that has at least one
    // seeded hard text Item, then archive every one of them: 10
    // Subsubcategories supply hard text for a Category (7 Items each, see
    // supabase/README.md "Pool coverage"); losing all of one drops that
    // count to 9, below the 10 the matcher needs to fill a Round.
    let targetItemIds: string[] = [];
    for (const subsubcategory of subsubcategories) {
      const { data: items, error: itemsError } = await db
        .from("items")
        .select("id")
        .eq("kind", "text")
        .eq("difficulty", "hard")
        .eq("subsubcategory_id", subsubcategory.id)
        .is("archived_at", null);
      if (itemsError) throw itemsError;
      if (items.length > 0) {
        targetItemIds = items.map((item) => item.id);
        break;
      }
    }
    expect(targetItemIds.length).toBeGreaterThan(0);

    const { error: archiveError } = await db
      .from("items")
      .update({ archived_at: new Date().toISOString() })
      .in("id", targetItemIds);
    if (archiveError) throw archiveError;
    archivedItemIds = targetItemIds;

    for (const locale of LOCALES) {
      const categories2 = await loadCoverage(locale);
      const category = categories2.find((c) => c.categoryId === String(categoryId));
      expect(category, `expected Category ${categoryId} in the loaded coverage (${locale})`).toBeDefined();

      const textRow = category!.rows.find((row) => row.kind === "text");
      expect(textRow!.cells.hard.fits, `expected text/hard to no longer fit (${locale})`).toBe(false);
    }
  });
});
