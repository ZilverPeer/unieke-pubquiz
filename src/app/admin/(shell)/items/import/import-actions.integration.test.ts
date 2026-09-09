/**
 * Integration tests for the Text Item bulk import server action (spec 4,
 * ticket #94). Runs against the real local Supabase stack, no mocking --
 * calls the exported action function directly with FormData and a File,
 * the same seam the import page calls through. assertOperator is bypassed
 * via the injectable `deps` parameter, the same pattern
 * src/app/admin/(shell)/items/actions.integration.test.ts uses for the
 * single Text Item form.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";
import { createRepository, resolveLocalStackConfig } from "@/repository";
import type { Database } from "@/repository/database.types";
import { createScopedCleanup } from "@/test-support/scoped-cleanup";
import { parseTextItemsCsv, TEXT_ITEM_IMPORT_HEADER } from "@/admin/items/import-csv";
import { importTextItems } from "./actions";
import { GET as templateGet } from "./template/route";

const config = resolveLocalStackConfig();
const db: SupabaseClient<Database> = createClient(config.url, config.serviceRoleKey);
const contentRepository = createRepository(config);

const cleanup = createScopedCleanup(db);
afterEach(async () => {
  await cleanup.cleanup();
});

const deps = {
  assertOperator: async () => ({ email: "operator@example.com" }),
  revalidateItems: () => {},
};

async function seedSubsubcategoryId(): Promise<string> {
  const { data, error } = await db.from("subsubcategories").select("id").order("id").limit(1).single();
  if (error) throw error;
  return String(data.id);
}

function uniqueMarker(): string {
  return `zzimport94-${randomUUID().slice(0, 8)}`;
}

function csvRow(subsubcategoryId: string, marker: string, overrides: Partial<Record<string, string>> = {}): string {
  const fields: Record<string, string> = {
    subsubcategoryId,
    difficulty: "medium",
    question_nl: "Vraag?",
    answer_nl: marker,
    fact_nl: "",
    question_en: "",
    answer_en: "",
    fact_en: "",
    ...overrides,
  };
  return TEXT_ITEM_IMPORT_HEADER.map((key) => fields[key]).join(",");
}

function csvFile(text: string): FormData {
  const data = new FormData();
  data.set("file", new File([text], "items.csv", { type: "text/csv" }));
  return data;
}

async function findByMarker(marker: string): Promise<string[]> {
  const { data, error } = await db.from("item_translations").select("item_id, answer").eq("answer", marker);
  if (error) throw error;
  return (data ?? []).map((row) => row.item_id);
}

describe("importTextItems", () => {
  it("creates three Items with Translations from three valid rows", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();
    const marker = uniqueMarker();
    const header = TEXT_ITEM_IMPORT_HEADER.join(",");
    const text = [header, csvRow(subsubcategoryId, marker), csvRow(subsubcategoryId, marker), csvRow(subsubcategoryId, marker)].join(
      "\n",
    );

    const result = await importTextItems(csvFile(text), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.count).toBe(3);

    const itemIds = await findByMarker(marker);
    for (const id of itemIds) cleanup.trackItemId(id);
    expect(itemIds).toHaveLength(3);

    const nlPool = await contentRepository.loadPool("nl");
    for (const id of itemIds) {
      expect(nlPool.some((entry) => entry.item.id === id)).toBe(true);
    }
  });

  it("creates nothing when row 2 has a bad Difficulty, and reports row 2", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();
    const marker = uniqueMarker();
    const header = TEXT_ITEM_IMPORT_HEADER.join(",");
    const text = [
      header,
      csvRow(subsubcategoryId, marker),
      csvRow(subsubcategoryId, marker, { difficulty: "extreme" }),
      csvRow(subsubcategoryId, marker),
    ].join("\n");

    const result = await importTextItems(csvFile(text), deps);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors).toEqual({ "rows.2.difficulty": "items.errors.difficultyRequired" });

    // Scoped to this test's own marker rather than the global items count
    // (shared stack, other tickets' suites can run concurrently) -- "nothing
    // created" is precisely "no Item carries this run's marker".
    const itemIds = await findByMarker(marker);
    expect(itemIds).toHaveLength(0);
  });

  it("refuses a 501-row file with tooManyRows and creates nothing", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();
    const marker = uniqueMarker();
    const header = TEXT_ITEM_IMPORT_HEADER.join(",");
    const rows = Array.from({ length: 501 }, () => csvRow(subsubcategoryId, marker));
    const text = [header, ...rows].join("\n");

    const result = await importTextItems(csvFile(text), deps);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors).toEqual({ file: "itemsImport.errors.tooManyRows" });

    const itemIds = await findByMarker(marker);
    expect(itemIds).toHaveLength(0);
  });
});

describe("template route", () => {
  it("returns the exact header the parser accepts, round-tripping with the example row replaced", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();
    const marker = uniqueMarker();

    const response = await templateGet(new Request("http://localhost/admin/items/import/template"), {
      assertOperator: deps.assertOperator,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="text-items-template.csv"');

    const templateText = await response.text();
    const lines = templateText.trim().split("\n");
    expect(lines[0]).toBe(TEXT_ITEM_IMPORT_HEADER.join(","));

    // Replace the template's example row with one real row and round-trip
    // it through the same parser the action uses.
    const roundTripText = [lines[0], csvRow(subsubcategoryId, marker)].join("\n");
    const result = parseTextItemsCsv(roundTripText, new Set([subsubcategoryId]));
    expect(result.ok).toBe(true);
  });
});
