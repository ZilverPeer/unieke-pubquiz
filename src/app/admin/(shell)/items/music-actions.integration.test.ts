/**
 * Integration tests for the Music Item admin server actions (spec 4,
 * ticket #91). Runs against the real local Supabase stack, no mocking --
 * calls the exported action functions directly with FormData and a real
 * File, the same seam the pages call through. assertOperator is bypassed
 * via the injectable `deps` parameter (admin-common brief "Tests").
 *
 * The fixture song is a 60 s 440 Hz tone rendered once in beforeAll with
 * runFfmpeg (the only place this codebase spawns ffmpeg,
 * src/render/music-round/ffmpeg.ts), so no media is ever committed to git
 * (CLAUDE.md "Content never enters git").
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildQuizContentFixture } from "@/domain";
import { renderMusicRoundMp3, resolveFfmpeg } from "@/render/music-round-mp3";
import { runFfmpeg } from "@/render/music-round/ffmpeg";
import { createRepository, resolveLocalStackConfig } from "@/repository";
import type { Database } from "@/repository/database.types";
import { probeDurationSeconds } from "@/repository/admin/music-items";
import { createScopedCleanup } from "@/test-support/scoped-cleanup";
import { createMusicItem, updateMusicItem } from "./music-actions";

const config = resolveLocalStackConfig();
const db: SupabaseClient<Database> = createClient(config.url, config.serviceRoleKey);
const contentRepository = createRepository(config);

const cleanup = createScopedCleanup(db);
const storagePaths = new Set<string>();

afterEach(async () => {
  await cleanup.cleanup();
});

afterAll(async () => {
  if (storagePaths.size > 0) {
    await db.storage.from("music-clips").remove([...storagePaths]);
  }
});

const deps = {
  assertOperator: async () => ({ email: "operator@example.com" }),
  revalidateItems: () => {},
};

let fixtureDir: string;
let toneSong: File;

beforeAll(async () => {
  const ffmpegPaths = resolveFfmpeg();
  if (!ffmpegPaths) throw new Error("music-actions.integration.test.ts requires a working ffmpeg/ffprobe");

  fixtureDir = await mkdtemp(join(tmpdir(), "zztest-music-fixture-"));
  const tonePath = join(fixtureDir, "tone.mp3");
  runFfmpeg(ffmpegPaths.ffmpeg, [
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=60",
    "-codec:a",
    "libmp3lame",
    tonePath,
  ]);
  const toneBytes = await readFile(tonePath);
  toneSong = new File([toneBytes], "tone.mp3", { type: "audio/mpeg" });
}, 30_000);

afterAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

async function seedSubsubcategoryId(): Promise<string> {
  const { data, error } = await db.from("subsubcategories").select("id").order("id").limit(1).single();
  if (error) throw error;
  return String(data.id);
}

function uniqueMarker(): string {
  return `zztest-${randomUUID().slice(0, 8)}`;
}

function baseFields(subsubcategoryId: string, overrides: Record<string, string> = {}): Record<string, string> {
  return {
    subsubcategoryId,
    difficulty: "medium",
    artist: "The Testers",
    title: uniqueMarker(),
    "nl.included": "on",
    startSeconds: "5",
    endSeconds: "25",
    ...overrides,
  };
}

function formData(fields: Record<string, string>, file?: File): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  if (file) data.set("file", file);
  return data;
}

/** No `pubquiz-music-*` temp directory may survive an action (ticket brief). */
async function assertNoLeftoverTempDirs(): Promise<void> {
  const entries = await readdir(tmpdir());
  const leftovers = entries.filter((entry) => entry.startsWith("pubquiz-music-"));
  expect(leftovers).toEqual([]);
}

async function downloadDurationSeconds(storagePath: string): Promise<number> {
  const { data, error } = await db.storage.from("music-clips").download(storagePath);
  if (error) throw error;
  const dir = await mkdtemp(join(tmpdir(), "zztest-music-check-"));
  try {
    const copyPath = join(dir, "clip.mp3");
    await writeFile(copyPath, new Uint8Array(await data.arrayBuffer()));
    return await probeDurationSeconds(copyPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function downloadHash(storagePath: string): Promise<string> {
  const { data, error } = await db.storage.from("music-clips").download(storagePath);
  if (error) throw error;
  const bytes = new Uint8Array(await data.arrayBuffer());
  return createHash("sha256").update(bytes).digest("hex");
}

describe("createMusicItem", () => {
  it("cuts and stores the clip, writes the detail row, and appears only in the ticked Locale's pool", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();
    const title = uniqueMarker();

    const result = await createMusicItem(formData(baseFields(subsubcategoryId, { title }), toneSong), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    cleanup.trackItemId(result.value.id);
    const storagePath = `${result.value.id}.mp3`;
    storagePaths.add(storagePath);

    const duration = await downloadDurationSeconds(storagePath);
    expect(Math.abs(duration - 20)).toBeLessThanOrEqual(0.5);

    const { data: detail, error } = await db
      .from("music_item_details")
      .select("storage_path, artist, title")
      .eq("item_id", result.value.id)
      .single();
    if (error) throw error;
    expect(detail).toEqual({ storage_path: storagePath, artist: "The Testers", title });

    const nlPool = await contentRepository.loadPool("nl");
    const enPool = await contentRepository.loadPool("en");
    expect(nlPool.some((entry) => entry.item.id === result.value.id)).toBe(true);
    expect(enPool.some((entry) => entry.item.id === result.value.id)).toBe(false);

    await assertNoLeftoverTempDirs();
  }, 30_000);

  it("refuses start after end and writes nothing", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();

    const result = await createMusicItem(
      formData(baseFields(subsubcategoryId, { startSeconds: "30", endSeconds: "20" }), toneSong),
      deps,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors).toEqual({ endSeconds: "musicItems.errors.range.order" });

    await assertNoLeftoverTempDirs();
  }, 30_000);

  it("refuses a clip over the maximum length and writes nothing", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();

    const result = await createMusicItem(
      formData(baseFields(subsubcategoryId, { startSeconds: "0", endSeconds: "50" }), toneSong),
      deps,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors).toEqual({ endSeconds: "musicItems.errors.range.length" });

    await assertNoLeftoverTempDirs();
  }, 30_000);
});

describe("updateMusicItem", () => {
  it("re-cuts from a newly uploaded song, keeping the Item id and storage path", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();
    const created = await createMusicItem(formData(baseFields(subsubcategoryId), toneSong), deps);
    if (!created.ok) throw new Error("expected success");
    cleanup.trackItemId(created.value.id);
    const storagePath = `${created.value.id}.mp3`;
    storagePaths.add(storagePath);

    const result = await updateMusicItem(
      created.value.id,
      formData(baseFields(subsubcategoryId, { startSeconds: "10", endSeconds: "40" }), toneSong),
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.id).toBe(created.value.id);

    const { data: detail, error } = await db
      .from("music_item_details")
      .select("storage_path")
      .eq("item_id", created.value.id)
      .single();
    if (error) throw error;
    expect(detail.storage_path).toBe(storagePath);

    const duration = await downloadDurationSeconds(storagePath);
    expect(Math.abs(duration - 30)).toBeLessThanOrEqual(0.5);

    await assertNoLeftoverTempDirs();
  }, 30_000);

  it("updates artist without a file, leaving the stored object untouched", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();
    const created = await createMusicItem(formData(baseFields(subsubcategoryId), toneSong), deps);
    if (!created.ok) throw new Error("expected success");
    cleanup.trackItemId(created.value.id);
    const storagePath = `${created.value.id}.mp3`;
    storagePaths.add(storagePath);

    const hashBefore = await downloadHash(storagePath);

    const result = await updateMusicItem(
      created.value.id,
      formData(baseFields(subsubcategoryId, { artist: "A New Artist", startSeconds: "", endSeconds: "" })),
      deps,
    );

    expect(result.ok).toBe(true);

    const { data: detail, error } = await db
      .from("music_item_details")
      .select("artist")
      .eq("item_id", created.value.id)
      .single();
    if (error) throw error;
    expect(detail.artist).toBe("A New Artist");

    const hashAfter = await downloadHash(storagePath);
    expect(hashAfter).toBe(hashBefore);

    await assertNoLeftoverTempDirs();
  }, 30_000);
});

describe("music round renderer", () => {
  it("renders a Round containing a Music Item created through createMusicItem", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();
    const created = await createMusicItem(formData(baseFields(subsubcategoryId), toneSong), deps);
    if (!created.ok) throw new Error("expected success");
    cleanup.trackItemId(created.value.id);
    const storagePath = `${created.value.id}.mp3`;
    storagePaths.add(storagePath);

    const { data: clipBlob, error } = await db.storage.from("music-clips").download(storagePath);
    if (error) throw error;
    const clip = new Uint8Array(await clipBlob.arrayBuffer());

    const quiz = buildQuizContentFixture({ locale: "nl", clip });
    const output = await renderMusicRoundMp3(quiz);

    const outDir = await mkdtemp(join(tmpdir(), "zztest-music-render-check-"));
    try {
      const clipPath = join(outDir, "clip.mp3");
      await writeFile(clipPath, clip);
      const clipDuration = await probeDurationSeconds(clipPath);

      const outputPath = join(outDir, "output.mp3");
      await writeFile(outputPath, output);
      const outputDuration = await probeDurationSeconds(outputPath);

      // At minimum, the rendered Round contains this clip once (plus
      // Announcements, gaps and 9 more clips) -- the renderer never trims.
      expect(outputDuration).toBeGreaterThanOrEqual(clipDuration);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  }, 60_000);
});
