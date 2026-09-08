/**
 * Integration tests for the Categories admin server actions (spec 4, ticket
 * #87). Runs against the real local Supabase stack -- see
 * src/repository/README.md for the run sequence. Never mocks Supabase.
 *
 * Every action takes an injectable `deps.assertOperator` (see ./actions.ts
 * and src/admin/auth/session.ts's assertOperator docblock): these tests
 * stub it to a fixed operator rather than going through a real cookie
 * session, per admin-common.md's brief for this ticket wave.
 *
 * Cleanup is scoped to exactly the ids this suite creates (categories admin
 * data has no billing_email seam for src/test-support/scoped-cleanup.ts to
 * key on) -- afterEach deletes tracked ids in child-first order along with
 * any Item created in a test, before its parent Subsubcategory.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";
import type { OperatorSession } from "@/admin/auth/session";
import { createCategoriesAdminRepository, type CategoriesAdminRepository } from "@/repository/admin/categories";
import { createRepository, resolveLocalStackConfig } from "@/repository";
import type { Database } from "@/repository/database.types";
import { addNode, deleteNode, renameNode, type ActionDeps } from "./actions";

const config = resolveLocalStackConfig();
const repository: CategoriesAdminRepository = createCategoriesAdminRepository(config);
const contentRepository = createRepository(config);
// Raw client for test arrangement/verification the admin repository doesn't
// expose (Items) and for cleanup.
const db: SupabaseClient<Database> = createClient(config.url, config.serviceRoleKey);

// Guards against the "categories.categories.errors..." bug (PR #109 fix
// round 1): validate.ts's error values are namespace-relative to the
// "categories" translator (src/app/admin/(shell)/categories/forms.tsx's
// useTranslations("categories")), so a validation error key must resolve
// inside messages/nl/categories.json without any "categories." prefix of
// its own. Reads the real message file rather than asserting a literal
// key string, so a renamed key still passes as long as both sides move
// together.
const nlCategoriesMessages: unknown = JSON.parse(
  readFileSync(join(process.cwd(), "messages", "nl", "categories.json"), "utf8"),
);

function messageKeyExists(key: string): boolean {
  const parts = key.split(".");
  let node: unknown = nlCategoriesMessages;
  for (const part of parts) {
    if (typeof node !== "object" || node === null || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string";
}

const stubOperator: OperatorSession = { email: "operator@example.com" };
async function assertOperator(): Promise<OperatorSession> {
  return stubOperator;
}

function deps(): ActionDeps {
  return { assertOperator, repository, revalidateCategories: () => {} };
}

const trackedCategoryIds = new Set<number>();
const trackedSubcategoryIds = new Set<number>();
const trackedSubsubcategoryIds = new Set<number>();
const trackedItemIds = new Set<string>();

afterEach(async () => {
  if (trackedItemIds.size > 0) {
    await db.from("items").delete().in("id", [...trackedItemIds]);
    trackedItemIds.clear();
  }
  if (trackedSubsubcategoryIds.size > 0) {
    await db.from("subsubcategories").delete().in("id", [...trackedSubsubcategoryIds]);
    trackedSubsubcategoryIds.clear();
  }
  if (trackedSubcategoryIds.size > 0) {
    await db.from("subcategories").delete().in("id", [...trackedSubcategoryIds]);
    trackedSubcategoryIds.clear();
  }
  if (trackedCategoryIds.size > 0) {
    await db.from("categories").delete().in("id", [...trackedCategoryIds]);
    trackedCategoryIds.clear();
  }
});

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

async function addCategory(nameNl: string, nameEn: string) {
  const result = await addNode(formData({ level: "category", nameNl, nameEn }), deps());
  if (!result.ok) throw new Error(`addCategory failed: ${JSON.stringify(result.errors)}`);
  trackedCategoryIds.add(result.value.id);
  return result.value.id;
}

async function addSubcategory(parentId: number, nameNl: string, nameEn: string) {
  const result = await addNode(
    formData({ level: "subcategory", parentId: String(parentId), nameNl, nameEn }),
    deps(),
  );
  if (!result.ok) throw new Error(`addSubcategory failed: ${JSON.stringify(result.errors)}`);
  trackedSubcategoryIds.add(result.value.id);
  return result.value.id;
}

async function addSubsubcategory(parentId: number, nameNl: string, nameEn: string) {
  const result = await addNode(
    formData({ level: "subsubcategory", parentId: String(parentId), nameNl, nameEn }),
    deps(),
  );
  if (!result.ok) throw new Error(`addSubsubcategory failed: ${JSON.stringify(result.errors)}`);
  trackedSubsubcategoryIds.add(result.value.id);
  return result.value.id;
}

async function createItemUnder(subsubcategoryId: number, locale: "nl" | "en" = "nl") {
  const { data, error } = await db
    .from("items")
    .insert({ kind: "text", difficulty: "easy", subsubcategory_id: subsubcategoryId })
    .select("id")
    .single();
  if (error) throw error;
  trackedItemIds.add(data.id);

  const { error: translationError } = await db
    .from("item_translations")
    .insert({ item_id: data.id, locale, question: "Q?", answer: "A." });
  if (translationError) throw translationError;

  return data.id;
}

describe("addNode", () => {
  it("adds a Category, a Subcategory and a Subsubcategory, each with both names", async () => {
    const categoryId = await addCategory("Sport", "Sports");
    const subcategoryId = await addSubcategory(categoryId, "Voetbal", "Football");
    const subsubcategoryId = await addSubsubcategory(subcategoryId, "Eredivisie", "Eredivisie");

    const tree = await repository.loadCategoryTree();
    const category = tree.find((node) => node.id === categoryId);
    expect(category?.names).toEqual({ nl: "Sport", en: "Sports" });

    const subcategory = category?.subcategories.find((node) => node.id === subcategoryId);
    expect(subcategory?.names).toEqual({ nl: "Voetbal", en: "Football" });

    const subsubcategory = subcategory?.subsubcategories.find((node) => node.id === subsubcategoryId);
    expect(subsubcategory?.names).toEqual({ nl: "Eredivisie", en: "Eredivisie" });
  });

  it("returns per-field validation errors and writes nothing for a missing name", async () => {
    const before = await repository.loadCategoryTree();

    const result = await addNode(
      formData({ level: "category", nameNl: "", nameEn: "Onherkenbare Naam Testcategorie" }),
      deps(),
    );

    expect(result).toEqual({ ok: false, errors: { nameNl: "errors.nameRequired" } });
    if (!result.ok) {
      for (const key of Object.values(result.errors)) {
        expect(messageKeyExists(key), `message key "${key}" is missing from messages/nl/categories.json`).toBe(true);
      }
      // The exact Dutch text the operator would see under the nl-locale
      // scoped translator (useTranslations("categories")) -- proves the
      // "categories.categories.errors..." double-prefix bug is fixed, since
      // that bug renders the raw key instead of this text.
      expect((nlCategoriesMessages as { errors: { nameRequired: string } }).errors.nameRequired).toBe(
        "Vul een naam in.",
      );
    }

    const after = await repository.loadCategoryTree();
    // Nothing written: same Category ids as before the rejected call (a
    // literal-name check would false-negative against a seeded/leftover
    // Category sharing the same name -- see the PR body's "Master-level
    // defects" note on the seed's un-synced identity sequences).
    expect(after.map((node) => node.id)).toEqual(before.map((node) => node.id));
  });
});

describe("renameNode", () => {
  it("renames a node in one Locale, leaving the other untouched", async () => {
    const categoryId = await addCategory("Sport", "Sports");

    const result = await renameNode(formData({ level: "category", id: String(categoryId), locale: "nl", name: "Sporten" }), deps());
    expect(result).toEqual({ ok: true, value: undefined });

    const tree = await repository.loadCategoryTree();
    const category = tree.find((node) => node.id === categoryId);
    expect(category?.names).toEqual({ nl: "Sporten", en: "Sports" });
  });

  it("is visible through createRepository(...).loadPool's category name", async () => {
    const categoryId = await addCategory("Muziek", "Music");
    const subcategoryId = await addSubcategory(categoryId, "Rock", "Rock");
    const subsubcategoryId = await addSubsubcategory(subcategoryId, "Jaren 80", "80s");
    await createItemUnder(subsubcategoryId, "nl");

    const renameResult = await renameNode(
      formData({ level: "category", id: String(categoryId), locale: "nl", name: "Muziek (hernoemd)" }),
      deps(),
    );
    expect(renameResult).toEqual({ ok: true, value: undefined });

    const pool = await contentRepository.loadPool("nl");
    const entry = pool.find((poolEntry) => poolEntry.item.subsubcategoryId === String(subsubcategoryId));
    expect(entry?.categoryName).toBe("Muziek (hernoemd)");
  });
});

describe("deleteNode", () => {
  it("refuses to delete a Category with a Subcategory, naming the count", async () => {
    const categoryId = await addCategory("Sport", "Sports");
    await addSubcategory(categoryId, "Voetbal", "Football");

    const result = await deleteNode(formData({ level: "category", id: String(categoryId) }), deps());

    expect(result).toEqual({ ok: true, value: { deleted: false, reason: "has-children", count: 1 } });

    const tree = await repository.loadCategoryTree();
    expect(tree.some((node) => node.id === categoryId)).toBe(true);
  });

  it("refuses to delete a Subsubcategory with an Item, naming the count", async () => {
    const categoryId = await addCategory("Sport", "Sports");
    const subcategoryId = await addSubcategory(categoryId, "Voetbal", "Football");
    const subsubcategoryId = await addSubsubcategory(subcategoryId, "Eredivisie", "Eredivisie");
    await createItemUnder(subsubcategoryId);

    const result = await deleteNode(formData({ level: "subsubcategory", id: String(subsubcategoryId) }), deps());

    expect(result).toEqual({ ok: true, value: { deleted: false, reason: "has-items", count: 1 } });
  });

  it("succeeds for an empty Subsubcategory", async () => {
    const categoryId = await addCategory("Sport", "Sports");
    const subcategoryId = await addSubcategory(categoryId, "Voetbal", "Football");
    const subsubcategoryId = await addSubsubcategory(subcategoryId, "Eredivisie", "Eredivisie");

    const result = await deleteNode(formData({ level: "subsubcategory", id: String(subsubcategoryId) }), deps());
    expect(result).toEqual({ ok: true, value: { deleted: true } });
    trackedSubsubcategoryIds.delete(subsubcategoryId);

    const tree = await repository.loadCategoryTree();
    const subcategory = tree.find((node) => node.id === categoryId)?.subcategories.find((node) => node.id === subcategoryId);
    expect(subcategory?.subsubcategories.some((node) => node.id === subsubcategoryId)).toBe(false);
  });
});
