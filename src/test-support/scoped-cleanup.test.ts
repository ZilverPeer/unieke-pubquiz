/**
 * Unit tests for createScopedCleanup's Item handling (ticket #112), driven
 * with a fake Supabase client instead of the real stack -- see
 * src/deliver/order-lookup.test.ts for the sibling pattern this follows.
 * Only exercises the itemIds path (removeItems); the email/quizId paths
 * are covered by scoped-cleanup.integration.test.ts against the real stack.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/repository/database.types";
import { createScopedCleanup } from "./scoped-cleanup";

interface FakeRow {
  [key: string]: unknown;
}

interface FakeTables {
  items: FakeRow[];
  item_translations: FakeRow[];
  composition_items: FakeRow[];
}

function fakeClient(tables: FakeTables): SupabaseClient<Database> {
  function from(table: keyof FakeTables) {
    return {
      select(columns: string) {
        void columns;
        return {
          in(column: string, values: unknown[]) {
            const data = tables[table].filter((row) => values.includes(row[column]));
            return Promise.resolve({ data, error: null });
          },
        };
      },
      delete() {
        return {
          in(column: string, values: unknown[]) {
            tables[table] = tables[table].filter((row) => !values.includes(row[column]));
            return Promise.resolve({ error: null });
          },
        };
      },
      update(patch: FakeRow) {
        return {
          in(column: string, values: unknown[]) {
            for (const row of tables[table]) {
              if (values.includes(row[column])) Object.assign(row, patch);
            }
            return Promise.resolve({ error: null });
          },
        };
      },
    };
  }
  return { from } as unknown as SupabaseClient<Database>;
}

describe("createScopedCleanup cleanup() -- Item handling", () => {
  it("deletes an unreferenced Item and its translations", async () => {
    const tables: FakeTables = {
      items: [{ id: "item-1", archived_at: null }],
      item_translations: [
        { item_id: "item-1", locale: "nl" },
        { item_id: "item-1", locale: "en" },
      ],
      composition_items: [],
    };
    const db = fakeClient(tables);
    const cleanup = createScopedCleanup(db);
    cleanup.trackItemId("item-1");

    await cleanup.cleanup();

    expect(tables.items).toHaveLength(0);
    expect(tables.item_translations).toHaveLength(0);
  });

  it("archives (not deletes) an Item a Composition references, and still removes its translations", async () => {
    const tables: FakeTables = {
      items: [{ id: "item-2", archived_at: null }],
      item_translations: [{ item_id: "item-2", locale: "nl" }],
      composition_items: [{ item_id: "item-2", composition_id: "comp-1" }],
    };
    const db = fakeClient(tables);
    const cleanup = createScopedCleanup(db);
    cleanup.trackItemId("item-2");

    await cleanup.cleanup();

    expect(tables.items).toHaveLength(1);
    expect(tables.items[0].archived_at).not.toBeNull();
    expect(tables.item_translations).toHaveLength(0);
  });

  it("archives a referenced Item and deletes an unreferenced one in the same call", async () => {
    const tables: FakeTables = {
      items: [
        { id: "item-referenced", archived_at: null },
        { id: "item-free", archived_at: null },
      ],
      item_translations: [
        { item_id: "item-referenced", locale: "nl" },
        { item_id: "item-free", locale: "nl" },
      ],
      composition_items: [{ item_id: "item-referenced", composition_id: "comp-1" }],
    };
    const db = fakeClient(tables);
    const cleanup = createScopedCleanup(db);
    cleanup.trackItemId("item-referenced");
    cleanup.trackItemId("item-free");

    await cleanup.cleanup();

    expect(tables.items.map((row) => row.id)).toEqual(["item-referenced"]);
    expect(tables.items[0].archived_at).not.toBeNull();
    expect(tables.item_translations).toHaveLength(0);
  });
});
