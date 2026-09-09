/**
 * Integration tests for the Item lifecycle server actions -- archive,
 * unarchive, delete (spec 4, ticket #89). Same seam as
 * actions.integration.test.ts: calls the exported action functions directly
 * against the real local stack, `deps` stubbed the same way. A Composition
 * that references the Item under test is built directly through
 * persistComposition() (src/repository/compositions.ts) -- a Composition row
 * only needs a billing email, Locale, requested Difficulty and seed, no
 * Order or Quiz, so that is the smallest fixture that makes an Item "used".
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";
import { createRepository, resolveLocalStackConfig } from "@/repository";
import type { Database } from "@/repository/database.types";
import { persistComposition } from "@/repository/compositions";
import { SLOT_COUNT } from "@/domain";
import { createScopedCleanup } from "@/test-support/scoped-cleanup";
import { archiveItem, createTextItem, deleteItem, unarchiveItem } from "./actions";

const config = resolveLocalStackConfig();
const db: SupabaseClient<Database> = createClient(config.url, config.serviceRoleKey);
const contentRepository = createRepository(config);

const cleanup = createScopedCleanup(db);
afterEach(async () => {
  await cleanup.cleanup();
});

// Same stub as actions.integration.test.ts: never throws NotAnOperatorError,
// revalidateItems is a no-op since revalidatePath() throws outside a real
// Next.js request.
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

async function createOwnTextItem(): Promise<string> {
  const subsubcategoryId = await seedSubsubcategoryId();
  const marker = uniqueMarker();
  const created = await createTextItem(formData(textItemFields(subsubcategoryId, { "nl.answer": marker })), deps);
  if (!created.ok) throw new Error("expected success");
  cleanup.trackItemId(created.value.id);
  return created.value.id;
}

/** A Composition referencing `itemId` in its first slot, nothing else -- the
 * smallest fixture that makes composition_items reference the Item. */
async function referenceItemInComposition(itemId: string, seed: number): Promise<void> {
  const email = cleanup.trackEmail(`t89-${randomUUID().slice(0, 8)}@example.com`);
  const slots: string[][] = Array.from({ length: SLOT_COUNT }, () => []);
  slots[0] = [itemId];
  await persistComposition(db, {
    billingEmail: email,
    locale: "nl",
    requestedDifficulty: "medium",
    seed,
    composition: { slots },
  });
}

describe("deleteItem", () => {
  it("removes an unused Text Item's base and translation rows", async () => {
    const itemId = await createOwnTextItem();

    const result = await deleteItem(itemId, deps);

    expect(result.ok).toBe(true);
    const { data: itemRow } = await db.from("items").select("id").eq("id", itemId).maybeSingle();
    expect(itemRow).toBeNull();
    const { data: translationRows, error } = await db.from("item_translations").select("item_id").eq("item_id", itemId);
    if (error) throw error;
    expect(translationRows).toEqual([]);
  });

  it("removes a Picture Item's detail row along with the base row", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();
    const { data: itemRow, error } = await db
      .from("items")
      .insert({ kind: "picture", subsubcategory_id: Number(subsubcategoryId), difficulty: "medium" })
      .select("id")
      .single();
    if (error) throw error;
    cleanup.trackItemId(itemRow.id);
    const { error: detailError } = await db
      .from("picture_item_details")
      .insert({ item_id: itemRow.id, storage_path: `zztest/${uniqueMarker()}.jpg` });
    if (detailError) throw detailError;

    const result = await deleteItem(itemRow.id, deps);

    expect(result.ok).toBe(true);
    const { data: detailRow, error: detailReadError } = await db
      .from("picture_item_details")
      .select("item_id")
      .eq("item_id", itemRow.id)
      .maybeSingle();
    if (detailReadError) throw detailReadError;
    expect(detailRow).toBeNull();
  });

  it("refuses to delete a used Item and changes nothing", async () => {
    const itemId = await createOwnTextItem();
    await referenceItemInComposition(itemId, 1);

    const { count: itemsBefore } = await db.from("items").select("id", { count: "exact", head: true });
    const { count: compositionItemsBefore } = await db
      .from("composition_items")
      .select("id", { count: "exact", head: true });

    const result = await deleteItem(itemId, deps);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors).toEqual({ item: "itemLifecycle.errors.inUse" });

    const { count: itemsAfter } = await db.from("items").select("id", { count: "exact", head: true });
    const { count: compositionItemsAfter } = await db
      .from("composition_items")
      .select("id", { count: "exact", head: true });
    expect(itemsAfter).toBe(itemsBefore);
    expect(compositionItemsAfter).toBe(compositionItemsBefore);
  });
});

describe("archiveItem / unarchiveItem", () => {
  it("archiving a used Item removes it from the pool, unarchiving restores it", async () => {
    const itemId = await createOwnTextItem();
    await referenceItemInComposition(itemId, 2);

    const archiveResult = await archiveItem(itemId, deps);
    expect(archiveResult.ok).toBe(true);

    const poolAfterArchive = await contentRepository.loadPool("nl");
    expect(poolAfterArchive.some((entry) => entry.item.id === itemId)).toBe(false);

    const { data: rowAfterArchive, error: rowAfterArchiveError } = await db
      .from("items")
      .select("archived_at")
      .eq("id", itemId)
      .single();
    if (rowAfterArchiveError) throw rowAfterArchiveError;
    expect(rowAfterArchive.archived_at).not.toBeNull();

    const unarchiveResult = await unarchiveItem(itemId, deps);
    expect(unarchiveResult.ok).toBe(true);

    const poolAfterUnarchive = await contentRepository.loadPool("nl");
    expect(poolAfterUnarchive.some((entry) => entry.item.id === itemId)).toBe(true);

    const { data: rowAfterUnarchive, error: rowAfterUnarchiveError } = await db
      .from("items")
      .select("archived_at")
      .eq("id", itemId)
      .single();
    if (rowAfterUnarchiveError) throw rowAfterUnarchiveError;
    expect(rowAfterUnarchive.archived_at).toBeNull();
  });
});
