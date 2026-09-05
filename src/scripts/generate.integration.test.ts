/**
 * Integration tests for the local dev generation script (ticket #11). Runs
 * against the real local Supabase stack with migrations and seed applied --
 * see README.md for the run sequence. Never mocks the repository, sampler,
 * or renderers -- this is the seam that proves the whole pipeline wired
 * together for real.
 *
 * ffmpeg-dependent assertions are skipped, the same way
 * src/render/music-round-mp3.test.ts skips, when ffmpeg isn't available.
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Locale } from "@/domain";
import { ITEMS_PER_SLOT, SLOT_COUNT } from "@/domain";
import { createRepository, resolveLocalStackConfig } from "@/repository";
import { resolveFfmpeg } from "@/render";
import type { GenerateOptions } from "./cli-args";
import { generateQuiz } from "./generate-quiz";

const config = resolveLocalStackConfig();
const repository = createRepository(config);

// Category id 1 is "Sport" (nl) / "Sports" (en) -- see supabase/seed.sql
// section 1. Every Category gets exactly 10 hard Text Items (one per
// Subsubcategory, zero slack -- see supabase/README.md "Pool coverage"), so
// picking it for slot 0 (a Text slot) at --difficulty hard consumes exactly
// its 10 hard Text Items. A second run with the same pick therefore fails
// slot 0 with shortfall 10, deterministically, regardless of how the other
// 7 slots' categories are randomised.
const HARD_TEXT_CATEGORY_ID = "1";
const HARD_TEXT_CATEGORY_NAME: Record<Locale, string> = { nl: "Sport", en: "Sports" };

function freshEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`;
}

function fullyRandomCategoryPicks(): GenerateOptions["categoryPicks"] {
  return new Array(SLOT_COUNT).fill(undefined);
}

async function makeTmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pubquiz-generate-test-"));
}

const REPO_ROOT = join(__dirname, "..", "..");

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", join(REPO_ROOT, "src", "scripts", "generate.ts"), ...args],
    {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      env: {
        ...process.env,
        SUPABASE_URL: config.url,
        SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey,
      },
    },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(resolveFfmpeg() === null)("generate CLI end to end (needs ffmpeg)", () => {
  it.each([["nl"], ["en"]] as const)(
    "generates a full %s Quiz via the CLI: four files with correct magic bytes, an 8x10 composition, and a persisted Composition",
    async (locale) => {
      const email = freshEmail(`full-${locale}`);
      const outDir = join(await makeTmpDir(), "run");
      try {
        const { status, stderr } = runCli([
          "--locale",
          locale,
          "--mode",
          "mixed",
          "--difficulty",
          "mixed",
          "--email",
          email,
          "--seed",
          "1",
          "--out",
          outDir,
        ]);
        expect(status, stderr).toBe(0);

        const quizmaster = await readFile(join(outDir, "quizmaster.pdf"));
        const pictureHandout = await readFile(join(outDir, "picture-handout.pdf"));
        const answerSheet = await readFile(join(outDir, "answer-sheet.pdf"));
        const musicRound = await readFile(join(outDir, "music-round.mp3"));

        expect(quizmaster.subarray(0, 4).toString()).toBe("%PDF");
        expect(pictureHandout.subarray(0, 4).toString()).toBe("%PDF");
        expect(answerSheet.subarray(0, 4).toString()).toBe("%PDF");

        const isId3 = musicRound[0] === 0x49 && musicRound[1] === 0x44 && musicRound[2] === 0x33;
        const isFrameSync = musicRound[0] === 0xff && (musicRound[1] & 0xe0) === 0xe0;
        expect(isId3 || isFrameSync).toBe(true);

        const composition = JSON.parse(await readFile(join(outDir, "composition.json"), "utf-8"));
        expect(composition.compositionId).toBeTruthy();
        expect(composition.composition.slots).toHaveLength(SLOT_COUNT);
        for (const slot of composition.composition.slots) {
          expect(slot).toHaveLength(ITEMS_PER_SLOT);
        }

        const allIds: string[] = composition.composition.slots.flat();
        const excluded = await repository.loadExcludedItemIds(email);
        expect(excluded).toEqual(new Set(allIds));
      } finally {
        await rm(outDir, { recursive: true, force: true });
      }
    },
  );

  it(
    "a second run for the same billing email shares no Item id with the first",
    async () => {
      const email = freshEmail("no-repeat");

      const result1 = await generateQuiz(
        {
          locale: "nl",
          quizMode: "mixed",
          categoryPicks: fullyRandomCategoryPicks(),
          requestedDifficulty: "mixed",
          billingEmail: email,
          seed: 100,
          out: "unused",
        },
        repository,
      );
      const result2 = await generateQuiz(
        {
          locale: "nl",
          quizMode: "mixed",
          categoryPicks: fullyRandomCategoryPicks(),
          requestedDifficulty: "mixed",
          billingEmail: email,
          seed: 101,
          out: "unused",
        },
        repository,
      );

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (!result1.ok || !result2.ok) return;

      const ids1 = new Set(result1.compositionRecord.composition.slots.flat());
      const ids2 = new Set(result2.compositionRecord.composition.slots.flat());
      const overlap = [...ids1].filter((id) => ids2.has(id));
      expect(overlap).toEqual([]);
    },
  );
});

describe.skipIf(resolveFfmpeg() === null)("unsatisfiable requests (needs ffmpeg)", () => {
  it("a second --difficulty hard run for the same email with the same Category pick fails slot 0 with shortfall 10, persists nothing, and writes no output folder", async () => {
    const email = freshEmail("unsatisfiable");
    const categoryPicks = fullyRandomCategoryPicks();
    categoryPicks[0] = HARD_TEXT_CATEGORY_ID;
    const outDir = join(await makeTmpDir(), "run-2");

    const firstResult = await generateQuiz(
      {
        locale: "nl",
        quizMode: "mixed",
        categoryPicks,
        requestedDifficulty: "hard",
        billingEmail: email,
        seed: 200,
        out: "unused",
      },
      repository,
    );
    expect(firstResult.ok).toBe(true);
    if (!firstResult.ok) return;

    const excludedAfterFirst = await repository.loadExcludedItemIds(email);

    const { status, stdout, stderr } = runCli([
      "--locale",
      "nl",
      "--mode",
      "mixed",
      "--difficulty",
      "hard",
      "--email",
      email,
      "--pick",
      `0=${HARD_TEXT_CATEGORY_ID}`,
      "--seed",
      "201",
      "--out",
      outDir,
    ]);

    expect(status).toBe(1);
    expect(stderr).toContain(
      `Generation failed: slot 0, Category ${HARD_TEXT_CATEGORY_NAME.nl}, shortfall 10`,
    );
    expect(stdout).not.toContain("Composition id");

    const excludedAfterSecond = await repository.loadExcludedItemIds(email);
    expect(excludedAfterSecond).toEqual(excludedAfterFirst);

    expect(await pathExists(join(outDir, "quizmaster.pdf"))).toBe(false);
    await expect(readdir(outDir)).rejects.toThrow();
  });
});
