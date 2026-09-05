import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildQuizContentFixture } from "@/domain";
import type { QuizContent } from "@/domain";
import { extractImages, extractText, getDocumentProxy } from "unpdf";
import { describe, expect, test } from "vitest";
import { renderPictureHandoutPdf } from "./picture-handout-pdf";

/** A valid 1x1 white PNG, the same one src/domain/fixtures.ts uses as a default. */
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
  "base64",
);

/**
 * Returns a distinct byte array derived from a valid 1x1 PNG by appending a
 * distinct trailing byte after IEND (harmless: PNG readers stop at IEND, so
 * the image itself is unchanged) — enough for a test to prove each of the 10
 * cells embeds its own image, without needing a real PNG encoder.
 */
function distinctPngBytes(index: number): Uint8Array {
  return Uint8Array.from(Buffer.concat([ONE_PIXEL_PNG, Buffer.from([index])]));
}

/** Returns a QuizContent whose 10 Picture Round images are all byte-distinct. */
function withDistinctPictureImages(quiz: QuizContent): QuizContent {
  return {
    ...quiz,
    rounds: quiz.rounds.map((round) => {
      if (round.kind !== "picture") return round;
      return {
        ...round,
        items: round.items.map((item, index) => {
          if (item.kind !== "picture") return item;
          return { ...item, image: distinctPngBytes(index) };
        }),
      };
    }),
  };
}

/** Returns a QuizContent whose Picture Round has the given (long) Category name. */
function withPictureCategoryName(quiz: QuizContent, categoryName: string): QuizContent {
  return {
    ...quiz,
    rounds: quiz.rounds.map((round) =>
      round.kind === "picture" ? { ...round, categoryName } : round,
    ),
  };
}

const scratchDir = path.join(process.cwd(), ".scratch");

/**
 * Writes a sample PDF for visual inspection, only when explicitly opted in
 * via PUBQUIZ_WRITE_SAMPLES=1 — a plain `npm test` run has no filesystem
 * side effects.
 */
async function writeScratch(name: string, buffer: Buffer): Promise<void> {
  if (process.env.PUBQUIZ_WRITE_SAMPLES !== "1") return;
  fs.mkdirSync(scratchDir, { recursive: true });
  fs.writeFileSync(path.join(scratchDir, name), buffer);
}

describe("renderPictureHandoutPdf", () => {
  test("renders a one-page PDF buffer", async () => {
    const quiz = buildQuizContentFixture({ locale: "nl" });

    const buffer = await renderPictureHandoutPdf(quiz);
    await writeScratch("picture-handout-nl.pdf", buffer);

    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    expect(pdf.numPages).toBe(1);
  });

  test("contains the heading, instruction, team-name label, and numbers 1 to 10", async () => {
    const quiz = buildQuizContentFixture({ locale: "nl" });

    const buffer = await renderPictureHandoutPdf(quiz);

    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });

    expect(text).toContain("Beeldronde: Categorie 7");
    expect(text).toContain("Schrijf je antwoord onder elk plaatje.");
    expect(text).toContain("Teamnaam");
    for (let n = 1; n <= 10; n++) {
      expect(text).toContain(String(n));
    }
  });

  test("places the 10 Picture Item images on the page", async () => {
    const quiz = withDistinctPictureImages(buildQuizContentFixture({ locale: "nl" }));

    const buffer = await renderPictureHandoutPdf(quiz);

    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const images = await extractImages(pdf, 1);
    // 10 distinct Picture Item images plus the one shared brand logo.
    expect(images.length).toBe(11);
  });

  test("wraps a long Category name within the page instead of overflowing it", async () => {
    // A single 60-character run with no natural hyphenation points (no vowel/
    // consonant pattern to break on) — the shape that overflowed the page
    // before the fix, unlike a name with spaces or word-like syllables, which
    // @react-pdf's default hyphenation already wraps.
    const longName = "A".repeat(60);
    const quiz = withPictureCategoryName(buildQuizContentFixture({ locale: "nl" }), longName);

    const buffer = await renderPictureHandoutPdf(quiz);
    await writeScratch("picture-handout-nl-long-category.pdf", buffer);

    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    expect(pdf.numPages).toBe(1);
    const { text } = await extractText(pdf, { mergePages: true });
    // Wrapping breaks the run across lines and @react-pdf inserts a visual
    // hyphen at the forced break point (mimicking real hyphenation), so
    // compare with line breaks and inserted hyphens collapsed.
    expect(text.replace(/[\n-]/g, "")).toContain(longName);
  });

  test("isolates locale: nl output has no en labels, en output has no nl labels", async () => {
    const nlBuffer = await renderPictureHandoutPdf(buildQuizContentFixture({ locale: "nl" }));
    await writeScratch("picture-handout-nl.pdf", nlBuffer);
    const enBuffer = await renderPictureHandoutPdf(buildQuizContentFixture({ locale: "en" }));
    await writeScratch("picture-handout-en.pdf", enBuffer);

    const nlText = (
      await extractText(await getDocumentProxy(new Uint8Array(nlBuffer)), { mergePages: true })
    ).text;
    const enText = (
      await extractText(await getDocumentProxy(new Uint8Array(enBuffer)), { mergePages: true })
    ).text;

    expect(enText).not.toContain("Beeldronde");
    expect(enText).not.toContain("Teamnaam");
    expect(enText).not.toContain("Schrijf je antwoord");

    expect(nlText).not.toContain("Picture Round");
    expect(nlText).not.toContain("Team name");
    expect(nlText).not.toContain("Write your answer");
  });

  test("never hardcodes a label string literal; all labels go through message()", () => {
    const sourcePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "picture-handout-pdf.tsx",
    );
    const source = fs.readFileSync(sourcePath, "utf8");
    // Strip comments so domain vocabulary in documentation doesn't false-positive;
    // only actual string literals in code should be checked.
    const codeOnly = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    const labelWords = [
      "Beeldronde",
      "Picture Round",
      "Schrijf je antwoord",
      "Write your answer",
      "Teamnaam",
      "Team name",
    ];

    for (const word of labelWords) {
      expect(codeOnly).not.toContain(word);
    }
  });
});
