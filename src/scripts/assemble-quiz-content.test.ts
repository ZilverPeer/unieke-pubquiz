/**
 * Unit tests for assembleQuizContent (no DB, no I/O -- downloads is a
 * boundary the test injects in-memory bytes for).
 */
import { describe, expect, it } from "vitest";
import { buildPoolFixture } from "@/domain";
import type { PoolEntry } from "@/repository";
import { assembleQuizContent, type QuizContentDownloads } from "./assemble-quiz-content";

function buildEntriesById(fixture: ReturnType<typeof buildPoolFixture>, locale: "nl" | "en") {
  const categoryNames = new Map(fixture.categories.map((c) => [c.id, c.name]));
  const entriesById = new Map<string, PoolEntry>();
  for (const item of fixture.pool) {
    const translation = fixture.translations[locale].get(item.id);
    if (!translation) continue;
    entriesById.set(item.id, {
      item,
      translation: {
        question: translation.question ?? null,
        answer: translation.answer,
        fact: translation.fact ?? null,
      },
      categoryName: categoryNames.get(item.categoryId) ?? "",
      picture: item.kind === "picture" ? { storagePath: `${item.id}.png` } : undefined,
      music:
        item.kind === "music"
          ? { storagePath: `${item.id}.mp3`, artist: `Artist ${item.id}`, title: `Title ${item.id}` }
          : undefined,
    });
  }
  return entriesById;
}

const noopDownloads: QuizContentDownloads = {
  picture: async () => new Uint8Array([1, 2, 3]),
  music: async () => new Uint8Array([4, 5, 6]),
};

describe("assembleQuizContent", () => {
  it("resolves a text Item's translation fields into TextItemContent", async () => {
    const fixture = buildPoolFixture({
      locales: ["nl"],
      categories: 1,
      subsubcategoriesPerCategory: 10,
      itemsPerKindPerDifficulty: 10,
    });
    const entriesById = buildEntriesById(fixture, "nl");
    const textItem = fixture.pool.find((i) => i.kind === "text")!;

    const composition = { slots: [Array(10).fill(textItem.id)] as string[][] };

    const content = await assembleQuizContent(composition, "nl", entriesById, noopDownloads);

    const [round] = content.rounds;
    expect(round.items[0]).toMatchObject({
      kind: "text",
      question: fixture.translations.nl.get(textItem.id)!.question,
      answer: fixture.translations.nl.get(textItem.id)!.answer,
    });
    expect(content.locale).toBe("nl");
  });

  it("downloads a picture Item's image via the injected boundary", async () => {
    const fixture = buildPoolFixture({
      locales: ["nl"],
      categories: 1,
      subsubcategoriesPerCategory: 10,
      itemsPerKindPerDifficulty: 10,
    });
    const entriesById = buildEntriesById(fixture, "nl");
    const pictureItem = fixture.pool.find((i) => i.kind === "picture")!;
    const composition = { slots: [Array(10).fill(pictureItem.id)] as string[][] };

    const downloadedPaths: string[] = [];
    const downloads: QuizContentDownloads = {
      picture: async (path) => {
        downloadedPaths.push(path);
        return new Uint8Array([9, 9, 9]);
      },
      music: async () => new Uint8Array(),
    };

    const content = await assembleQuizContent(composition, "nl", entriesById, downloads);

    expect(content.rounds[0].items[0]).toMatchObject({ kind: "picture" });
    const pictureContent = content.rounds[0].items[0] as { image: Uint8Array };
    expect(Array.from(pictureContent.image)).toEqual([9, 9, 9]);
    expect(downloadedPaths).toContain(`${pictureItem.id}.png`);
  });

  it("downloads a music Item's clip via the injected boundary and carries artist/title", async () => {
    const fixture = buildPoolFixture({
      locales: ["nl"],
      categories: 1,
      subsubcategoriesPerCategory: 10,
      itemsPerKindPerDifficulty: 10,
    });
    const entriesById = buildEntriesById(fixture, "nl");
    const musicItem = fixture.pool.find((i) => i.kind === "music")!;
    const composition = { slots: [Array(10).fill(musicItem.id)] as string[][] };

    const downloads: QuizContentDownloads = {
      picture: async () => new Uint8Array(),
      music: async () => new Uint8Array([7, 7]),
    };

    const content = await assembleQuizContent(composition, "nl", entriesById, downloads);

    expect(content.rounds[0].items[0]).toMatchObject({
      kind: "music",
      artist: `Artist ${musicItem.id}`,
      title: `Title ${musicItem.id}`,
    });
    const musicContent = content.rounds[0].items[0] as { clip: Uint8Array };
    expect(Array.from(musicContent.clip)).toEqual([7, 7]);
  });

  it("throws when a text Item's translation is missing its question", async () => {
    const fixture = buildPoolFixture({
      locales: ["nl"],
      categories: 1,
      subsubcategoriesPerCategory: 10,
      itemsPerKindPerDifficulty: 10,
    });
    const entriesById = buildEntriesById(fixture, "nl");
    const textItem = fixture.pool.find((i) => i.kind === "text")!;
    const entry = entriesById.get(textItem.id)!;
    entriesById.set(textItem.id, { ...entry, translation: { ...entry.translation, question: null } });
    const composition = { slots: [Array(10).fill(textItem.id)] as string[][] };

    await expect(assembleQuizContent(composition, "nl", entriesById, noopDownloads)).rejects.toThrow(
      /question/,
    );
  });

  it("throws when the Composition references an Item id not in entriesById", async () => {
    const fixture = buildPoolFixture({
      locales: ["nl"],
      categories: 1,
      subsubcategoriesPerCategory: 10,
      itemsPerKindPerDifficulty: 10,
    });
    const entriesById = buildEntriesById(fixture, "nl");
    const composition = { slots: [Array(10).fill("unknown-item-id")] as string[][] };

    await expect(assembleQuizContent(composition, "nl", entriesById, noopDownloads)).rejects.toThrow(
      /unknown-item-id/,
    );
  });
});
