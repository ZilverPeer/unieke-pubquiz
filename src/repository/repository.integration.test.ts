/**
 * Integration tests for the content repository (seam 2, ticket #6). Runs
 * against the real local Supabase stack with migrations and seed applied --
 * see README.md for the run sequence. Never mocks Supabase.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";
import type { CompositionRecord } from "@/domain";
import { ITEMS_PER_SLOT, SLOT_COUNT } from "@/domain";
import type { Database } from "./database.types";
import { createRepository } from "./index";
import { resolveLocalStackConfig } from "./test-support/local-stack-config";

const config = resolveLocalStackConfig();
const repository = createRepository(config);
// Raw client for test arrangement/verification -- the repository under test
// is only exercised through its public interface.
const db: SupabaseClient<Database> = createClient(config.url, config.serviceRoleKey);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

beforeEach(async () => {
  // compositions cascade-deletes composition_items; seed Items are never touched.
  const { error } = await db.from("compositions").delete().not("id", "is", null);
  if (error) throw error;
});

async function itemIdsMissingLocale(kind: "text" | "picture" | "music", missing: "nl" | "en") {
  const { data, error } = await db.from("items").select("id, item_translations(locale)").eq("kind", kind);
  if (error) throw error;
  return data
    .filter((row) => !row.item_translations.some((t) => t.locale === missing))
    .map((row) => row.id);
}

describe("loadPool", () => {
  it("returns only Items with an nl translation, 717 entries", async () => {
    const enOnlyIds = [
      ...(await itemIdsMissingLocale("text", "nl")),
      ...(await itemIdsMissingLocale("picture", "nl")),
      ...(await itemIdsMissingLocale("music", "nl")),
    ];
    expect(enOnlyIds).toHaveLength(3);

    const pool = await repository.loadPool("nl");

    expect(pool).toHaveLength(717);
    for (const entry of pool) {
      expect(entry.item.locales).toContain("nl");
      expect(entry.item.kind).toBeTruthy();
      expect(entry.item.difficulty).toBeTruthy();
      expect(entry.item.categoryId).toBeTruthy();
      expect(entry.item.subsubcategoryId).toBeTruthy();
    }
    const poolIds = new Set(pool.map((e) => e.item.id));
    for (const id of enOnlyIds) {
      expect(poolIds.has(id)).toBe(false);
    }
  });

  it("returns only Items with an en translation, 717 entries", async () => {
    const nlOnlyIds = [
      ...(await itemIdsMissingLocale("text", "en")),
      ...(await itemIdsMissingLocale("picture", "en")),
      ...(await itemIdsMissingLocale("music", "en")),
    ];
    expect(nlOnlyIds).toHaveLength(3);

    const pool = await repository.loadPool("en");

    expect(pool).toHaveLength(717);
    for (const entry of pool) {
      expect(entry.item.locales).toContain("en");
    }
    const poolIds = new Set(pool.map((e) => e.item.id));
    for (const id of nlOnlyIds) {
      expect(poolIds.has(id)).toBe(false);
    }
  });

  it("carries detail data per kind and the requested Locale's Category name", async () => {
    const pool = await repository.loadPool("nl");

    const textEntry = pool.find((e) => e.item.kind === "text");
    const pictureEntry = pool.find((e) => e.item.kind === "picture");
    const musicEntry = pool.find((e) => e.item.kind === "music");

    expect(textEntry?.picture).toBeUndefined();
    expect(textEntry?.music).toBeUndefined();

    expect(pictureEntry?.picture?.storagePath).toBeTruthy();
    expect(pictureEntry?.music).toBeUndefined();

    expect(musicEntry?.music?.storagePath).toBeTruthy();
    expect(musicEntry?.music?.artist).toBeTruthy();
    expect(musicEntry?.music?.title).toBeTruthy();
    expect(musicEntry?.picture).toBeUndefined();

    const category1EntryNl = pool.find((e) => e.item.categoryId === "1");
    expect(category1EntryNl?.categoryName).toBe("Sport");

    const poolEn = await repository.loadPool("en");
    const category1EntryEn = poolEn.find((e) => e.item.categoryId === "1");
    expect(category1EntryEn?.categoryName).toBe("Sports");
  });
});

describe("loadExcludedItemIds", () => {
  it("is empty for an unknown billing email", async () => {
    const result = await repository.loadExcludedItemIds("nobody@example.com");
    expect(result).toEqual(new Set());
  });

  it("returns the union of a billing email's persisted Compositions' item ids", async () => {
    const pool = await repository.loadPool("nl");
    const firstIds = pool.slice(0, 80).map((e) => e.item.id);
    const secondIds = pool.slice(80, 160).map((e) => e.item.id);
    const email = "customer@example.com";

    await repository.persistComposition(buildRecord(email, firstIds));
    const afterFirst = await repository.loadExcludedItemIds(email);
    expect(afterFirst).toEqual(new Set(firstIds));

    await repository.persistComposition(buildRecord(email, secondIds));
    const afterSecond = await repository.loadExcludedItemIds(email);
    expect(afterSecond.size).toBe(160);
    expect(afterSecond).toEqual(new Set([...firstIds, ...secondIds]));
  });

  it("compares billing emails trimmed and case-insensitively", async () => {
    const pool = await repository.loadPool("nl");
    const ids = pool.slice(0, 80).map((e) => e.item.id);

    await repository.persistComposition(buildRecord("review-probe@example.com", ids));
    const result = await repository.loadExcludedItemIds("  REVIEW-PROBE@EXAMPLE.COM  ");

    expect(result).toEqual(new Set(ids));
  });

  it("does not leak one billing email's Composition into another's exclusions", async () => {
    const pool = await repository.loadPool("nl");
    const idsForA = pool.slice(0, 80).map((e) => e.item.id);

    await repository.persistComposition(buildRecord("email-a@example.com", idsForA));
    const excludedForB = await repository.loadExcludedItemIds("email-b@example.com");

    expect(excludedForB).toEqual(new Set());
  });
});

describe("persistComposition", () => {
  it("stores slot_index and position reproducing the Composition's slots in order", async () => {
    const pool = await repository.loadPool("nl");
    const ids = pool.slice(0, 80).map((e) => e.item.id);
    const record = buildRecord("slots@example.com", ids);

    const { compositionId } = await repository.persistComposition(record);

    const { data, error } = await db
      .from("composition_items")
      .select("slot_index, position, item_id")
      .eq("composition_id", compositionId)
      .order("slot_index", { ascending: true })
      .order("position", { ascending: true });
    if (error) throw error;

    const reconstructed: string[][] = [];
    for (const row of data) {
      reconstructed[row.slot_index] ??= [];
      reconstructed[row.slot_index][row.position] = row.item_id;
    }

    expect(reconstructed).toEqual(record.composition.slots);
  });
});

describe("downloadPicture / downloadMusicClip", () => {
  it("downloads a picture from the pictures bucket starting with the PNG signature", async () => {
    const bytes = await repository.downloadPicture("placeholder-blue.png");
    expect(Array.from(bytes.slice(0, PNG_SIGNATURE.length))).toEqual(PNG_SIGNATURE);
  });

  it("downloads a music clip from the music-clips bucket as non-empty bytes", async () => {
    const bytes = await repository.downloadMusicClip("tone-a.mp3");
    expect(bytes.length).toBeGreaterThan(0);
  });
});

function buildRecord(billingEmail: string, itemIds: string[]): CompositionRecord {
  if (itemIds.length !== SLOT_COUNT * ITEMS_PER_SLOT) {
    throw new Error(`expected ${SLOT_COUNT * ITEMS_PER_SLOT} item ids, got ${itemIds.length}`);
  }
  const slots: string[][] = [];
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    slots.push(itemIds.slice(slot * ITEMS_PER_SLOT, (slot + 1) * ITEMS_PER_SLOT));
  }
  return {
    billingEmail,
    locale: "nl",
    quizMode: "mixed",
    requestedDifficulty: "mixed",
    seed: 1,
    composition: { slots },
  };
}
