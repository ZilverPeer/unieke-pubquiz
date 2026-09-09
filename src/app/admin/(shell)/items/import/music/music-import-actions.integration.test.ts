/**
 * Integration tests for the Music Item bulk import server action (spec 4,
 * ticket #96). Runs against the real local Supabase stack, no mocking --
 * calls the exported action function directly with FormData carrying a CSV
 * File and a zip File built with zipSync from a 60 s tone rendered once in
 * beforeAll (the same fixture shape as ../../music-actions.integration.test.ts,
 * so no media is ever committed to git, CLAUDE.md "Content never enters
 * git"). assertOperator is bypassed via the injectable `deps` parameter.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRepository, resolveLocalStackConfig } from "@/repository";
import type { Database } from "@/repository/database.types";
import { probeDurationSeconds } from "@/repository/admin/music-items";
import { createScopedCleanup } from "@/test-support/scoped-cleanup";
import { MUSIC_ITEM_IMPORT_HEADER, parseMusicItemsCsv } from "@/admin/items/import-music-csv";
import { resolveFfmpeg, runFfmpeg } from "@/render/music-round/ffmpeg";
import { importMusicItems } from "./actions";
import { GET as templateGet } from "./template/route";

const config = resolveLocalStackConfig();
const db: SupabaseClient<Database> = createClient(config.url, config.serviceRoleKey);
const contentRepository = createRepository(config);

const cleanup = createScopedCleanup(db);
const storagePaths: string[] = [];

afterAll(async () => {
  await cleanup.cleanup();
  if (storagePaths.length > 0) {
    const { error } = await db.storage.from("music-clips").remove(storagePaths);
    if (error) throw error;
  }
});

const deps = {
  assertOperator: async () => ({ email: "operator@example.com" }),
  revalidateItems: () => {},
};

let fixtureDir: string;
let toneBytes: Uint8Array;

async function renderTone(): Promise<void> {
  const ffmpegPaths = resolveFfmpeg();
  if (!ffmpegPaths) throw new Error("music-import-actions.integration.test.ts requires a working ffmpeg/ffprobe");

  fixtureDir = await mkdtemp(join(tmpdir(), "zztest-music-import-fixture-"));
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
  toneBytes = await readFile(tonePath);
}

beforeAll(renderTone, 60_000);

afterAll(async () => {
  if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
});

async function seedSubsubcategoryId(): Promise<string> {
  const { data, error } = await db.from("subsubcategories").select("id").order("id").limit(1).single();
  if (error) throw error;
  return String(data.id);
}

function uniqueMarker(): string {
  return `zzimport96-${randomUUID().slice(0, 8)}`;
}

function csvRow(
  file: string,
  subsubcategoryId: string,
  marker: string,
  overrides: Partial<Record<(typeof MUSIC_ITEM_IMPORT_HEADER)[number], string>> = {},
): string {
  const fields: Record<string, string> = {
    file,
    subsubcategoryId,
    difficulty: "medium",
    artist: "The Testers",
    title: marker,
    startSeconds: "5",
    endSeconds: "25",
    locales: "nl",
    ...overrides,
  };
  return MUSIC_ITEM_IMPORT_HEADER.map((key) => fields[key]).join(",");
}

function importFormData(csvText: string, zipEntries: Record<string, Uint8Array>): FormData {
  const data = new FormData();
  data.set("csv", new File([csvText], "items.csv", { type: "text/csv" }));
  const zipBytes = zipSync(zipEntries);
  data.set("zip", new File([new Uint8Array(zipBytes)], "songs.zip", { type: "application/zip" }));
  return data;
}

async function findByMarker(marker: string): Promise<string[]> {
  const { data, error } = await db.from("music_item_details").select("item_id, title").eq("title", marker);
  if (error) throw error;
  return (data ?? []).map((row) => row.item_id);
}

async function itemCount(): Promise<number> {
  const { count, error } = await db.from("items").select("id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

async function musicClipsObjectCount(): Promise<number> {
  const { data, error } = await db.storage.from("music-clips").list();
  if (error) throw error;
  return (data ?? []).length;
}

/** No `pubquiz-music-*` temp directory may survive an import (ticket brief). */
async function assertNoLeftoverTempDirs(): Promise<void> {
  const entries = await readdir(tmpdir());
  const leftovers = entries.filter((entry) => entry.startsWith("pubquiz-music-"));
  expect(leftovers).toEqual([]);
}

describe("importMusicItems", () => {
  it(
    "creates two Music Items from a zip of two songs and a matching CSV, cutting each to its own range",
    async () => {
      const subsubcategoryId = await seedSubsubcategoryId();
      const marker = uniqueMarker();
      const header = MUSIC_ITEM_IMPORT_HEADER.join(",");
      const text = [
        header,
        csvRow("song-one.mp3", subsubcategoryId, marker, { startSeconds: "5", endSeconds: "25" }),
        csvRow("song-two.mp3", subsubcategoryId, marker, { startSeconds: "10", endSeconds: "40" }),
      ].join("\n");

      const zipEntries = { "song-one.mp3": toneBytes, "song-two.mp3": toneBytes };

      const result = await importMusicItems(importFormData(text, zipEntries), deps);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");
      expect(result.value.count).toBe(2);

      const itemIds = await findByMarker(marker);
      for (const id of itemIds) cleanup.trackItemId(id);
      expect(itemIds).toHaveLength(2);

      const durations: number[] = [];
      for (const id of itemIds) {
        const storagePath = `${id}.mp3`;
        storagePaths.push(storagePath);
        const { data: downloaded, error } = await db.storage.from("music-clips").download(storagePath);
        if (error) throw error;
        const dir = await mkdtemp(join(tmpdir(), "zztest-music-import-check-"));
        try {
          const copyPath = join(dir, "clip.mp3");
          await writeFile(copyPath, new Uint8Array(await downloaded.arrayBuffer()));
          durations.push(await probeDurationSeconds(copyPath));
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      }
      durations.sort((a, b) => a - b);
      expect(Math.abs(durations[0] - 20)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(durations[1] - 30)).toBeLessThanOrEqual(0.5);

      const nlPool = await contentRepository.loadPool("nl");
      for (const id of itemIds) {
        expect(nlPool.some((entry) => entry.item.id === id)).toBe(true);
      }

      await assertNoLeftoverTempDirs();
    },
    60_000,
  );

  it(
    "creates nothing when a row's end is before its start, and reports the row",
    async () => {
      const subsubcategoryId = await seedSubsubcategoryId();
      const marker = uniqueMarker();
      const header = MUSIC_ITEM_IMPORT_HEADER.join(",");
      const text = [header, csvRow("song-one.mp3", subsubcategoryId, marker, { startSeconds: "30", endSeconds: "20" })].join(
        "\n",
      );

      const beforeItems = await itemCount();
      const beforeClips = await musicClipsObjectCount();

      const zipEntries = { "song-one.mp3": toneBytes };
      const result = await importMusicItems(importFormData(text, zipEntries), deps);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(result.errors["rows.1.endSeconds"]).toBe("musicItems.errors.range.order");

      expect(await itemCount()).toBe(beforeItems);
      expect(await musicClipsObjectCount()).toBe(beforeClips);
      expect(await findByMarker(marker)).toHaveLength(0);
      await assertNoLeftoverTempDirs();
    },
    30_000,
  );

  it(
    "creates nothing when a zip entry named .mp3 is not real audio, and reports fileNotAudio",
    async () => {
      const subsubcategoryId = await seedSubsubcategoryId();
      const marker = uniqueMarker();
      const header = MUSIC_ITEM_IMPORT_HEADER.join(",");
      const text = [header, csvRow("fake.mp3", subsubcategoryId, marker)].join("\n");

      const beforeItems = await itemCount();
      const beforeClips = await musicClipsObjectCount();

      const zipEntries = { "fake.mp3": randomBytes(2048) };
      const result = await importMusicItems(importFormData(text, zipEntries), deps);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(result.errors["rows.1.file"]).toBe("musicImport.errors.fileNotAudio");

      expect(await itemCount()).toBe(beforeItems);
      expect(await musicClipsObjectCount()).toBe(beforeClips);
      expect(await findByMarker(marker)).toHaveLength(0);
      await assertNoLeftoverTempDirs();
    },
    30_000,
  );

  it("creates nothing when a CSV row names a file not in the zip, and reports fileMissing", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();
    const marker = uniqueMarker();
    const header = MUSIC_ITEM_IMPORT_HEADER.join(",");
    const text = [header, csvRow("missing.mp3", subsubcategoryId, marker)].join("\n");

    const beforeItems = await itemCount();
    const beforeClips = await musicClipsObjectCount();

    const zipEntries = { "other.mp3": randomBytes(1024) };
    const result = await importMusicItems(importFormData(text, zipEntries), deps);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors["rows.1.file"]).toBe("musicImport.errors.fileMissing");

    expect(await itemCount()).toBe(beforeItems);
    expect(await musicClipsObjectCount()).toBe(beforeClips);
    expect(await findByMarker(marker)).toHaveLength(0);
  });
});

describe("music template route", () => {
  it("returns the exact header the parser accepts, round-tripping with the example row replaced", async () => {
    const subsubcategoryId = await seedSubsubcategoryId();
    const marker = uniqueMarker();

    const response = await templateGet(new Request("http://localhost/admin/items/import/music/template"), {
      assertOperator: deps.assertOperator,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="music-items-template.csv"');

    const templateText = await response.text();
    const lines = templateText.trim().split("\n");
    expect(lines[0]).toBe(MUSIC_ITEM_IMPORT_HEADER.join(","));

    const roundTripText = [lines[0], csvRow("song.mp3", subsubcategoryId, marker)].join("\n");
    const result = parseMusicItemsCsv(roundTripText, new Set([subsubcategoryId]));
    expect(result.ok).toBe(true);
  });
});
