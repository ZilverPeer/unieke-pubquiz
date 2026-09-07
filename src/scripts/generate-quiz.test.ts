/**
 * Unit tests for generateQuiz's ordering guarantee: Deliverables are
 * written before the Composition is persisted (no DB -- repository is
 * faked, the system boundary this seam is allowed to fake). Renderers are
 * real (never mocked); the music renderer needs ffmpeg, so this suite skips
 * like src/render/music-round-mp3.test.ts does when it's unavailable.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPoolFixture } from "@/domain";
import type { ContentRepository, PoolEntry } from "@/repository";
import { resolveFfmpeg } from "@/render";
import type { GenerateOptions } from "./cli-args";
import { generateQuiz, type GeneratedQuizFiles, type WriteDeliverables } from "./generate-quiz";

// A real mp3 -- ffmpeg (used by renderMusicRoundMp3, never mocked) rejects
// arbitrary bytes as an invalid input file.
const TONE_A = join(__dirname, "..", "..", "supabase", "seed-assets", "music-clips", "tone-a.mp3");

async function buildFakeRepository(): Promise<ContentRepository> {
  // 7 Items per (kind, Difficulty, Subsubcategory) - `baseOptions` below is
  // `single_category`, and `sampleComposition` excludes Items already
  // placed by earlier slots of the same Composition, so the 6 "text" slots
  // need well more than one Item per Subsubcategory to each draw a fresh 10.
  const fixture = buildPoolFixture({
    locales: ["nl"],
    categories: 1,
    subsubcategoriesPerCategory: 10,
    itemsPerKindPerDifficulty: 70,
  });
  const categoryName = fixture.categories[0].name;

  const pool: PoolEntry[] = fixture.pool.map((item) => {
    const translation = fixture.translations.nl.get(item.id)!;
    return {
      item,
      translation: {
        question: translation.question ?? null,
        answer: translation.answer,
        fact: translation.fact ?? null,
      },
      categoryName,
      picture: item.kind === "picture" ? { storagePath: `${item.id}.png` } : undefined,
      music:
        item.kind === "music"
          ? { storagePath: `${item.id}.mp3`, artist: `Artist ${item.id}`, title: `Title ${item.id}` }
          : undefined,
    };
  });

  const toneA = new Uint8Array(await readFile(TONE_A));

  return {
    loadPool: async () => pool,
    loadExcludedItemIds: async () => new Set(),
    persistComposition: async () => {
      throw new Error("persistComposition should not be reachable in this test");
    },
    getCompositionById: async () => {
      throw new Error("getCompositionById should not be reachable in this test");
    },
    downloadPicture: async () => new Uint8Array([1, 2, 3]),
    downloadMusicClip: async () => toneA,
  };
}

function baseOptions(): GenerateOptions {
  return {
    locale: "nl",
    quizMode: "single_category",
    categoryPicks: ["category-0", undefined, undefined, undefined, undefined, undefined, undefined, undefined],
    requestedDifficulty: "easy",
    billingEmail: "generate-quiz-test@example.com",
    seed: 1,
    out: "unused",
  };
}

describe.skipIf(resolveFfmpeg() === null)("generateQuiz: write before persist", () => {
  it("never calls persistComposition when writeDeliverables rejects", async () => {
    let persistCalled = false;
    const repository: ContentRepository = {
      ...(await buildFakeRepository()),
      persistComposition: async () => {
        persistCalled = true;
        return { compositionId: "should-not-happen" };
      },
    };
    const failingWriter: WriteDeliverables = async () => {
      throw new Error("disk full");
    };

    await expect(generateQuiz(baseOptions(), repository, failingWriter)).rejects.toThrow("disk full");
    expect(persistCalled).toBe(false);
  });

  it("calls writeDeliverables with the rendered files before persisting", async () => {
    const callOrder: string[] = [];
    const repository: ContentRepository = {
      ...(await buildFakeRepository()),
      persistComposition: async () => {
        callOrder.push("persist");
        return { compositionId: "composition-1" };
      },
    };
    const writer = async (files: GeneratedQuizFiles): Promise<void> => {
      callOrder.push("write");
      expect(Object.keys(files)).toEqual([
        "quizmaster.pdf",
        "picture-handout.pdf",
        "answer-sheet.pdf",
        "music-round.mp3",
      ]);
    };

    const result = await generateQuiz(baseOptions(), repository, writer);

    expect(result.ok).toBe(true);
    expect(callOrder).toEqual(["write", "persist"]);
  });
});
