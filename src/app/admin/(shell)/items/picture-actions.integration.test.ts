/**
 * Integration tests for the Picture Item admin server actions (spec 4,
 * ticket #90). Runs against the real local Supabase stack, no mocking --
 * calls the exported action functions directly with FormData carrying a
 * real `File`, the same seam the pages call through (assertOperator is
 * bypassed via the injectable `deps` parameter, same pattern as
 * actions.integration.test.ts).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { buildQuizContentFixture } from "@/domain";
import { renderPictureHandoutPdf } from "@/render/picture-handout-pdf";
import { createRepository, resolveLocalStackConfig } from "@/repository";
import type { Database } from "@/repository/database.types";
import { createScopedCleanup } from "@/test-support/scoped-cleanup";
import { createPictureItem, updatePictureItem } from "./picture-actions";

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

async function pngBuffer(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 120, g: 160, b: 200 } } })
    .png()
    .toBuffer();
}

function pictureFile(bytes: Buffer, name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function pictureFormData(subsubcategoryId: string, file: File | null, overrides: Record<string, string> = {}): FormData {
  const data = new FormData();
  data.set("subsubcategoryId", subsubcategoryId);
  data.set("difficulty", overrides.difficulty ?? "medium");
  data.set("nl.answer", overrides["nl.answer"] ?? "Antwoord");
  data.set("nl.fact", overrides["nl.fact"] ?? "");
  data.set("en.answer", overrides["en.answer"] ?? "");
  data.set("en.fact", overrides["en.fact"] ?? "");
  if (file) data.set("file", file);
  return data;
}

async function itemCount(): Promise<number> {
  const { count, error } = await db.from("items").select("id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

describe("createPictureItem", () => {
  it("resizes a large image to the max edge and stores it as JPEG", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();
    const file = pictureFile(await pngBuffer(3000, 2000), "big.png", "image/png");

    const result = await createPictureItem(pictureFormData(subsubcategoryId, file), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    cleanup.trackItemId(result.value.id);
    const storagePath = `${result.value.id}.jpg`;
    storagePaths.push(storagePath);

    const { data: detail, error: detailError } = await db
      .from("picture_item_details")
      .select("storage_path")
      .eq("item_id", result.value.id)
      .single();
    if (detailError) throw detailError;
    expect(detail.storage_path).toBe(storagePath);

    const { data: downloaded, error: downloadError } = await db.storage.from("pictures").download(storagePath);
    if (downloadError) throw downloadError;
    const metadata = await sharp(Buffer.from(await downloaded.arrayBuffer())).metadata();
    expect(metadata.width).toBe(1600);
    expect(metadata.height).toBe(1067);
    expect(metadata.format).toBe("jpeg");

    const nlPool = await contentRepository.loadPool("nl");
    const enPool = await contentRepository.loadPool("en");
    expect(nlPool.some((entry) => entry.item.id === result.value.id)).toBe(true);
    expect(enPool.some((entry) => entry.item.id === result.value.id)).toBe(false);
  });

  it("does not upscale a smaller source image", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();
    const file = pictureFile(await pngBuffer(400, 300), "small.png", "image/png");

    const result = await createPictureItem(pictureFormData(subsubcategoryId, file), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    cleanup.trackItemId(result.value.id);
    const storagePath = `${result.value.id}.jpg`;
    storagePaths.push(storagePath);

    const { data: downloaded, error: downloadError } = await db.storage.from("pictures").download(storagePath);
    if (downloadError) throw downloadError;
    const metadata = await sharp(Buffer.from(await downloaded.arrayBuffer())).metadata();
    expect(metadata.width).toBe(400);
    expect(metadata.height).toBe(300);
  });

  it("refuses a missing file on create and writes nothing", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();
    const before = await itemCount();

    const result = await createPictureItem(pictureFormData(subsubcategoryId, null), deps);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors).toEqual({ file: "pictureItems.errors.file.required" });
    expect(await itemCount()).toBe(before);
  });

  it("refuses a file with a disallowed MIME type and writes nothing", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();
    const before = await itemCount();
    const file = pictureFile(await pngBuffer(100, 100), "note.txt", "text/plain");

    const result = await createPictureItem(pictureFormData(subsubcategoryId, file), deps);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors).toEqual({ file: "pictureItems.errors.file.type" });
    expect(await itemCount()).toBe(before);
  });

  it("refuses bytes that are not really an image and writes nothing", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();
    const before = await itemCount();
    const file = pictureFile(Buffer.from("not an image, just text bytes"), "fake.png", "image/png");

    const result = await createPictureItem(pictureFormData(subsubcategoryId, file), deps);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors).toEqual({ file: "pictureItems.errors.file.notImage" });
    expect(await itemCount()).toBe(before);
  });
});

describe("updatePictureItem", () => {
  it("replaces the image at the same storage_path, keeping the Item id", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();
    const created = await createPictureItem(
      pictureFormData(subsubcategoryId, pictureFile(await pngBuffer(500, 500), "first.png", "image/png")),
      deps,
    );
    if (!created.ok) throw new Error("expected success");
    cleanup.trackItemId(created.value.id);
    const storagePath = `${created.value.id}.jpg`;
    storagePaths.push(storagePath);

    const result = await updatePictureItem(
      created.value.id,
      pictureFormData(subsubcategoryId, pictureFile(await pngBuffer(2000, 3000), "second.png", "image/png")),
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.id).toBe(created.value.id);

    const { data: detail, error: detailError } = await db
      .from("picture_item_details")
      .select("storage_path")
      .eq("item_id", created.value.id)
      .single();
    if (detailError) throw detailError;
    expect(detail.storage_path).toBe(storagePath);

    const { data: downloaded, error: downloadError } = await db.storage.from("pictures").download(storagePath);
    if (downloadError) throw downloadError;
    const metadata = await sharp(Buffer.from(await downloaded.arrayBuffer())).metadata();
    expect(metadata.width).toBe(1067);
    expect(metadata.height).toBe(1600);
  });

  it("changes translations and leaves the stored object untouched when no file is given", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();
    const created = await createPictureItem(
      pictureFormData(subsubcategoryId, pictureFile(await pngBuffer(600, 400), "third.png", "image/png")),
      deps,
    );
    if (!created.ok) throw new Error("expected success");
    cleanup.trackItemId(created.value.id);
    const storagePath = `${created.value.id}.jpg`;
    storagePaths.push(storagePath);

    const { data: before, error: beforeError } = await db.storage.from("pictures").download(storagePath);
    if (beforeError) throw beforeError;
    const beforeSize = (await before.arrayBuffer()).byteLength;

    const result = await updatePictureItem(
      created.value.id,
      pictureFormData(subsubcategoryId, null, { "nl.answer": "Nieuw antwoord" }),
      deps,
    );

    expect(result.ok).toBe(true);
    const { data: translation, error: translationError } = await db
      .from("item_translations")
      .select("answer")
      .eq("item_id", created.value.id)
      .eq("locale", "nl")
      .single();
    if (translationError) throw translationError;
    expect(translation.answer).toBe("Nieuw antwoord");

    const { data: after, error: afterError } = await db.storage.from("pictures").download(storagePath);
    if (afterError) throw afterError;
    const afterSize = (await after.arrayBuffer()).byteLength;
    expect(afterSize).toBe(beforeSize);
  });
});

describe("picture handout rendering", () => {
  it("renders a PDF for a Picture Item created through this action", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();
    const created = await createPictureItem(
      pictureFormData(subsubcategoryId, pictureFile(await pngBuffer(800, 600), "render.png", "image/png")),
      deps,
    );
    if (!created.ok) throw new Error("expected success");
    cleanup.trackItemId(created.value.id);
    const storagePath = `${created.value.id}.jpg`;
    storagePaths.push(storagePath);

    const { data: downloaded, error: downloadError } = await db.storage.from("pictures").download(storagePath);
    if (downloadError) throw downloadError;
    const image = new Uint8Array(await downloaded.arrayBuffer());

    const quiz = buildQuizContentFixture({ locale: "nl", image });
    const buffer = await renderPictureHandoutPdf(quiz);

    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });
});
