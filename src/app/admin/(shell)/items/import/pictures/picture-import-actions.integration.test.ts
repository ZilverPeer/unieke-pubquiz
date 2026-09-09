/**
 * Integration tests for the Picture Item bulk import server action (spec 4,
 * ticket #95). Runs against the real local Supabase stack, no mocking --
 * calls the exported action function directly with FormData carrying a CSV
 * File and a zip File built with zipSync from PNGs made with sharp, the
 * same seam the import page calls through. assertOperator is bypassed via
 * the injectable `deps` parameter, same pattern as the Text import's own
 * import-actions.integration.test.ts.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { zipSync } from "fflate";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createRepository, resolveLocalStackConfig } from "@/repository";
import type { Database } from "@/repository/database.types";
import { createScopedCleanup } from "@/test-support/scoped-cleanup";
import { parsePictureItemsCsv, PICTURE_ITEM_IMPORT_HEADER } from "@/admin/items/import-picture-csv";
import { createPictureItems, type CreatePictureItemsInput } from "@/repository/admin/picture-items";
import { importPictureItems } from "./actions";
import { GET as templateGet } from "./template/route";

const config = resolveLocalStackConfig();
const db: SupabaseClient<Database> = createClient(config.url, config.serviceRoleKey);
const contentRepository = createRepository(config);

const cleanup = createScopedCleanup(db);
const storagePaths: string[] = [];

afterAll(async () => {
  await cleanup.cleanup();
  if (storagePaths.length > 0) {
    const { error } = await db.storage.from("pictures").remove(storagePaths);
    if (error) throw error;
  }
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
  return `zzimport95-${randomUUID().slice(0, 8)}`;
}

async function pngBuffer(width: number, height: number): Promise<Uint8Array> {
  return sharp({ create: { width, height, channels: 3, background: { r: 90, g: 140, b: 210 } } })
    .png()
    .toBuffer();
}

function csvRow(
  file: string,
  subsubcategoryId: string,
  marker: string,
  overrides: Partial<Record<(typeof PICTURE_ITEM_IMPORT_HEADER)[number], string>> = {},
): string {
  const fields: Record<string, string> = {
    file,
    subsubcategoryId,
    difficulty: "medium",
    answer_nl: marker,
    fact_nl: "",
    answer_en: "",
    fact_en: "",
    ...overrides,
  };
  return PICTURE_ITEM_IMPORT_HEADER.map((key) => fields[key]).join(",");
}

function importFormData(csvText: string, zipEntries: Record<string, Uint8Array>): FormData {
  const data = new FormData();
  data.set("csv", new File([csvText], "items.csv", { type: "text/csv" }));
  const zipBytes = zipSync(zipEntries);
  data.set("zip", new File([new Uint8Array(zipBytes)], "images.zip", { type: "application/zip" }));
  return data;
}

async function findByMarker(marker: string): Promise<string[]> {
  const { data, error } = await db.from("item_translations").select("item_id, answer").eq("answer", marker);
  if (error) throw error;
  return (data ?? []).map((row) => row.item_id);
}

async function itemCount(): Promise<number> {
  const { count, error } = await db.from("items").select("id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

async function picturesObjectCount(): Promise<number> {
  const { data, error } = await db.storage.from("pictures").list();
  if (error) throw error;
  return (data ?? []).length;
}

describe("importPictureItems", () => {
  it("creates three Picture Items from a zip of three images and a matching CSV, resizing the large one", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();
    const marker = uniqueMarker();
    const header = PICTURE_ITEM_IMPORT_HEADER.join(",");
    const text = [
      header,
      csvRow("big.png", subsubcategoryId, marker),
      csvRow("small.png", subsubcategoryId, marker),
      csvRow("medium.png", subsubcategoryId, marker),
    ].join("\n");

    const zipEntries = {
      "big.png": await pngBuffer(3000, 2000),
      "small.png": await pngBuffer(200, 150),
      "medium.png": await pngBuffer(800, 600),
    };

    const result = await importPictureItems(importFormData(text, zipEntries), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.count).toBe(3);

    const itemIds = await findByMarker(marker);
    for (const id of itemIds) cleanup.trackItemId(id);
    expect(itemIds).toHaveLength(3);

    for (const id of itemIds) {
      const storagePath = `${id}.jpg`;
      storagePaths.push(storagePath);
      const { data: detail, error: detailError } = await db
        .from("picture_item_details")
        .select("storage_path")
        .eq("item_id", id)
        .single();
      if (detailError) throw detailError;
      expect(detail.storage_path).toBe(storagePath);

      const { data: downloaded, error: downloadError } = await db.storage.from("pictures").download(storagePath);
      if (downloadError) throw downloadError;
      expect(Buffer.from(await downloaded.arrayBuffer()).length).toBeGreaterThan(0);
    }

    // The big source (3000x2000) must have been resized to at most 1600 on the long edge.
    // Ids are not guaranteed to be returned in row order, so all three are
    // checked and at least one must show the resized dimensions.
    let sawResized = false;
    for (const id of itemIds) {
      const { data: downloaded, error: downloadError } = await db.storage.from("pictures").download(`${id}.jpg`);
      if (downloadError) throw downloadError;
      const metadata = await sharp(Buffer.from(await downloaded.arrayBuffer())).metadata();
      expect(metadata.format).toBe("jpeg");
      if (metadata.width === 1600 && metadata.height === 1067) sawResized = true;
    }
    expect(sawResized).toBe(true);

    const nlPool = await contentRepository.loadPool("nl");
    for (const id of itemIds) {
      expect(nlPool.some((entry) => entry.item.id === id)).toBe(true);
    }
  });

  it("creates nothing when a CSV row names a file not in the zip, and reports fileMissing", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();
    const marker = uniqueMarker();
    const header = PICTURE_ITEM_IMPORT_HEADER.join(",");
    const text = [header, csvRow("missing.png", subsubcategoryId, marker)].join("\n");

    const beforeItems = await itemCount();
    const beforeObjects = await picturesObjectCount();

    const zipEntries = { "other.png": await pngBuffer(100, 100) };
    const result = await importPictureItems(importFormData(text, zipEntries), deps);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors["rows.1.file"]).toBe("pictureImport.errors.fileMissing");

    expect(await itemCount()).toBe(beforeItems);
    expect(await picturesObjectCount()).toBe(beforeObjects);
    expect(await findByMarker(marker)).toHaveLength(0);
  });

  it("creates nothing when a zip entry is a text file named .png, and reports fileNotImage", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();
    const marker = uniqueMarker();
    const header = PICTURE_ITEM_IMPORT_HEADER.join(",");
    const text = [header, csvRow("fake.png", subsubcategoryId, marker)].join("\n");

    const beforeItems = await itemCount();
    const beforeObjects = await picturesObjectCount();

    const zipEntries = { "fake.png": new TextEncoder().encode("not an image, just text bytes") };
    const result = await importPictureItems(importFormData(text, zipEntries), deps);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors["rows.1.file"]).toBe("pictureImport.errors.fileNotImage");

    expect(await itemCount()).toBe(beforeItems);
    expect(await picturesObjectCount()).toBe(beforeObjects);
    expect(await findByMarker(marker)).toHaveLength(0);
  });

  it("creates nothing when the zip has an entry no row names, and reports fileUnused", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();
    const marker = uniqueMarker();
    const header = PICTURE_ITEM_IMPORT_HEADER.join(",");
    const text = [header, csvRow("used.png", subsubcategoryId, marker)].join("\n");

    const beforeItems = await itemCount();
    const beforeObjects = await picturesObjectCount();

    const zipEntries = {
      "used.png": await pngBuffer(100, 100),
      "extra.png": await pngBuffer(100, 100),
    };
    const result = await importPictureItems(importFormData(text, zipEntries), deps);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors["rows.0.extra.png"]).toBe("pictureImport.errors.fileUnused");

    expect(await itemCount()).toBe(beforeItems);
    expect(await picturesObjectCount()).toBe(beforeObjects);
    expect(await findByMarker(marker)).toHaveLength(0);
  });
});

describe("createPictureItems rollback (repository seam, Standards fix round 1)", () => {
  it("removes the already-uploaded object and deletes both item rows when a later image is not a real image", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();

    const beforeItems = await itemCount();
    const beforeObjects = await picturesObjectCount();

    const inputs: CreatePictureItemsInput[] = [
      {
        subsubcategoryId,
        difficulty: "medium",
        translations: { nl: { answer: "Eerste" } },
        image: Buffer.from(await pngBuffer(200, 200)),
      },
      {
        subsubcategoryId,
        difficulty: "medium",
        translations: { nl: { answer: "Tweede" } },
        image: Buffer.from("not an image, just random text bytes"),
      },
    ];

    await expect(createPictureItems(db, inputs)).rejects.toThrow();

    expect(await itemCount()).toBe(beforeItems);
    expect(await picturesObjectCount()).toBe(beforeObjects);
  });
});

describe("picture template route", () => {
  it("returns the exact header the parser accepts, round-tripping with the example row replaced", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();
    const marker = uniqueMarker();

    const response = await templateGet(new Request("http://localhost/admin/items/import/pictures/template"), {
      assertOperator: deps.assertOperator,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="picture-items-template.csv"');

    const templateText = await response.text();
    const lines = templateText.trim().split("\n");
    expect(lines[0]).toBe(PICTURE_ITEM_IMPORT_HEADER.join(","));

    const roundTripText = [lines[0], csvRow("photo.jpg", subsubcategoryId, marker)].join("\n");
    const result = parsePictureItemsCsv(roundTripText, new Set([subsubcategoryId]));
    expect(result.ok).toBe(true);
  });
});
