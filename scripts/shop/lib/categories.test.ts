import { describe, expect, test } from "vitest";
import { encodeCategoriesForWpCli, loadDutchCategoriesFromClient } from "./categories";

/**
 * Unit seams for ticket #57's Category-name source: the base64 encoding
 * helper (pure) and the "zero categories" error path, both driven with a
 * faked Supabase client -- no running stack needed. loadDutchCategories()
 * itself (which resolves the real stack config and builds a real client) is
 * exercised empirically against the running stack per the ticket brief, not
 * here.
 */

interface FakeTable {
  select: () => FakeQuery;
}

interface FakeQuery {
  order?: (column: string) => FakeQuery;
  eq?: (column: string, value: string) => FakeQuery;
  then: (resolve: (result: { data: unknown[] | null; error: unknown }) => void) => void;
}

function fakeResult(data: unknown[] | null, error: unknown = null) {
  const query: FakeQuery = {
    order: () => query,
    eq: () => query,
    then: (resolve) => resolve({ data, error }),
  };
  return query;
}

function fakeClient(tables: Record<string, FakeQuery>) {
  return {
    from(name: string): FakeTable {
      return {
        select: () => tables[name] ?? fakeResult([]),
      };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("encodeCategoriesForWpCli", () => {
  test("base64-encodes the Category list as JSON", () => {
    const encoded = encodeCategoriesForWpCli([{ id: "1", name: "Sport" }]);
    const decoded = JSON.parse(Buffer.from(encoded, "base64").toString("utf-8"));
    expect(decoded).toEqual([{ id: "1", name: "Sport" }]);
  });
});

describe("loadDutchCategoriesFromClient", () => {
  test("throws when the stack has zero Categories", async () => {
    const client = fakeClient({
      categories: fakeResult([]),
      category_translations: fakeResult([]),
    });

    await expect(loadDutchCategoriesFromClient(client)).rejects.toThrow(/no categories/i);
  });

  test("returns id/name pairs ordered by id for Categories with an nl translation", async () => {
    const client = fakeClient({
      categories: fakeResult([{ id: 2 }, { id: 1 }]),
      category_translations: fakeResult([
        { category_id: 1, name: "Sport" },
        { category_id: 2, name: "Geschiedenis" },
      ]),
    });

    await expect(loadDutchCategoriesFromClient(client)).resolves.toEqual([
      { id: "1", name: "Sport" },
      { id: "2", name: "Geschiedenis" },
    ]);
  });
});
