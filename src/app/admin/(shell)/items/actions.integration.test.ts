/**
 * Integration tests for the Items admin server actions (spec 4, ticket
 * #88). Runs against the real local Supabase stack, no mocking -- calls
 * the exported action functions directly with FormData, the same seam the
 * pages call through. assertOperator is bypassed via the injectable
 * `deps` parameter (admin-common brief "Tests"): these actions must not
 * call requireOperator() themselves, the shell layout already guards the
 * page render.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";
import { createRepository, resolveLocalStackConfig } from "@/repository";
import type { Database } from "@/repository/database.types";
import { listItems } from "@/repository/admin/items";
import { createScopedCleanup } from "@/test-support/scoped-cleanup";
import { createTextItem, updateTextItem } from "./actions";

const config = resolveLocalStackConfig();
const db: SupabaseClient<Database> = createClient(config.url, config.serviceRoleKey);
const contentRepository = createRepository(config);

const cleanup = createScopedCleanup(db);
afterEach(async () => {
  await cleanup.cleanup();
});

// A stub that never throws NotAnOperatorError -- the tests exercise the
// action's own logic, not the Supabase Auth session (see docblock above).
const deps = { assertOperator: async () => ({ email: "operator@example.com" }) };

async function seedSubsubcategoryId(): Promise<string> {
  const { data, error } = await db.from("subsubcategories").select("id").order("id").limit(1).single();
  if (error) throw error;
  return String(data.id);
}

function uniqueMarker(): string {
  return `zztest-${randomUUID().slice(0, 8)}`;
}

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function textItemFields(subsubcategoryId: string, overrides: Record<string, string> = {}): Record<string, string> {
  return {
    subsubcategoryId,
    difficulty: "medium",
    "nl.question": "Wat is de hoofdstad van Nederland?",
    "nl.answer": "Amsterdam",
    "nl.fact": "",
    "en.question": "",
    "en.answer": "",
    "en.fact": "",
    ...overrides,
  };
}

describe("createTextItem", () => {
  it("creates an Item with both Locales", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();
    const marker = uniqueMarker();

    const result = await createTextItem(
      formData(
        textItemFields(subsubcategoryId, {
          "nl.answer": marker,
          "en.question": "What is the capital of the Netherlands?",
          "en.answer": marker,
        }),
      ),
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    cleanup.trackItemId(result.value.id);

    const { data: translations, error } = await db
      .from("item_translations")
      .select("locale")
      .eq("item_id", result.value.id);
    if (error) throw error;
    expect(translations.map((t) => t.locale).sort()).toEqual(["en", "nl"]);
  });

  it("creates an Item with only nl, appearing in the nl pool and not the en pool", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();
    const marker = uniqueMarker();

    const result = await createTextItem(formData(textItemFields(subsubcategoryId, { "nl.answer": marker })), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    cleanup.trackItemId(result.value.id);

    const nlPool = await contentRepository.loadPool("nl");
    const enPool = await contentRepository.loadPool("en");
    expect(nlPool.some((entry) => entry.item.id === result.value.id)).toBe(true);
    expect(enPool.some((entry) => entry.item.id === result.value.id)).toBe(false);
  });

  it("refuses a half-filled Locale and writes nothing", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();

    const result = await createTextItem(
      formData(textItemFields(subsubcategoryId, { "en.answer": "Answer only, no question" })),
      deps,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors).toEqual({ "en.question": "items.errors.localeIncomplete" });
  });

  it("refuses an unknown Subsubcategory", async () => {
    const result = await createTextItem(formData(textItemFields("999999999")), deps);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors).toEqual({ subsubcategoryId: "items.errors.subsubcategoryRequired" });
  });
});

describe("updateTextItem", () => {
  it("adds an en translation to an nl-only Item", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();
    const marker = uniqueMarker();
    const created = await createTextItem(formData(textItemFields(subsubcategoryId, { "nl.answer": marker })), deps);
    if (!created.ok) throw new Error("expected success");
    cleanup.trackItemId(created.value.id);

    const result = await updateTextItem(
      created.value.id,
      formData(
        textItemFields(subsubcategoryId, {
          "nl.answer": marker,
          "en.question": "Added later?",
          "en.answer": "Yes",
        }),
      ),
      deps,
    );

    expect(result.ok).toBe(true);
    const { data: translations, error } = await db
      .from("item_translations")
      .select("locale")
      .eq("item_id", created.value.id);
    if (error) throw error;
    expect(translations.map((t) => t.locale).sort()).toEqual(["en", "nl"]);
  });

  it("moves the Subsubcategory and Difficulty", async () => {
    const originalSubsubcategoryId = await seedSubsubcategoryId();
    const { data: allSubsubcategories, error: subsubError } = await db
      .from("subsubcategories")
      .select("id")
      .order("id")
      .limit(2);
    if (subsubError) throw subsubError;
    const newSubsubcategoryId = String(allSubsubcategories[1].id);

    const marker = uniqueMarker();
    const created = await createTextItem(
      formData(textItemFields(originalSubsubcategoryId, { "nl.answer": marker, difficulty: "easy" })),
      deps,
    );
    if (!created.ok) throw new Error("expected success");
    cleanup.trackItemId(created.value.id);

    const result = await updateTextItem(
      created.value.id,
      formData(textItemFields(newSubsubcategoryId, { "nl.answer": marker, difficulty: "hard" })),
      deps,
    );

    expect(result.ok).toBe(true);
    const { data: itemRow, error } = await db
      .from("items")
      .select("subsubcategory_id, difficulty")
      .eq("id", created.value.id)
      .single();
    if (error) throw error;
    expect(String(itemRow.subsubcategory_id)).toBe(newSubsubcategoryId);
    expect(itemRow.difficulty).toBe("hard");
  });
});

describe("listItems", () => {
  it("filters by kind, Category, Difficulty, missing Locale, and searches by answer text", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();
    const { data: chain, error: chainError } = await db
      .from("subsubcategories")
      .select("id, subcategory_id, subcategories(id, category_id)")
      .eq("id", Number(subsubcategoryId))
      .single();
    if (chainError) throw chainError;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const categoryId = String((chain as any).subcategories.category_id);

    const marker = uniqueMarker();
    const created = await createTextItem(
      formData(textItemFields(subsubcategoryId, { "nl.answer": marker, difficulty: "hard" })),
      deps,
    );
    if (!created.ok) throw new Error("expected success");
    cleanup.trackItemId(created.value.id);

    const byKind = await listItems(db, { locale: "nl", kind: "text", page: 1, pageSize: 5000 });
    expect(byKind.items.some((item) => item.id === created.value.id)).toBe(true);

    const byCategory = await listItems(db, { locale: "nl", categoryId, page: 1, pageSize: 5000 });
    expect(byCategory.items.some((item) => item.id === created.value.id)).toBe(true);

    const byDifficulty = await listItems(db, { locale: "nl", difficulty: "hard", page: 1, pageSize: 5000 });
    expect(byDifficulty.items.some((item) => item.id === created.value.id)).toBe(true);

    const byMissingEn = await listItems(db, { locale: "nl", missingLocale: "en", page: 1, pageSize: 5000 });
    expect(byMissingEn.items.some((item) => item.id === created.value.id)).toBe(true);

    const byMissingNl = await listItems(db, { locale: "nl", missingLocale: "nl", page: 1, pageSize: 5000 });
    expect(byMissingNl.items.some((item) => item.id === created.value.id)).toBe(false);

    const bySearch = await listItems(db, { locale: "nl", query: marker, page: 1, pageSize: 5000 });
    expect(bySearch.items.map((item) => item.id)).toEqual([created.value.id]);
  });
});
