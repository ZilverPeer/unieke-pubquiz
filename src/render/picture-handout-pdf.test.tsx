import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { buildQuizContentFixture } from "@/domain";
import type { QuizContent } from "@/domain";
import { extractImages, extractText, getDocumentProxy } from "unpdf";
import { describe, expect, test } from "vitest";
import { renderPictureHandoutPdf } from "./picture-handout-pdf";

/**
 * Builds a minimal valid single-color 8-bit grayscale PNG at the given
 * dimensions — enough for @react-pdf/image (png-js) and pdfkit's own PNG
 * parser to read real width/height metadata, without needing an image
 * encoding library as a dependency.
 */
function buildGrayscalePng(width: number, height: number): Uint8Array {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function chunk(type: string, data: Buffer): Buffer {
    const typeBuf = Buffer.from(type, "ascii");
    const lengthBuf = Buffer.alloc(4);
    lengthBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([lengthBuf, typeBuf, data, crcBuf]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // color type: grayscale
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // One filter-type byte (0 = none) followed by `width` gray pixel bytes, per row.
  const raw = Buffer.alloc(height * (1 + width), 0xcc);
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width)] = 0;
  }
  const idat = zlib.deflateSync(raw);

  return new Uint8Array(
    Buffer.concat([
      signature,
      chunk("IHDR", ihdr),
      chunk("IDAT", idat),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

/**
 * Builds a minimal valid single-color baseline JPEG at the given dimensions:
 * SOI, a bare SOF0 header carrying width/height, an SOS marker, a few
 * non-marker scan bytes, then EOI. Both jay-peg (used by @react-pdf/image
 * for layout) and pdfkit's own JPEG parser (used when embedding) only read
 * the SOF0 header for width/height/component count — real entropy-coded
 * pixel data is never decoded by either, so this is sufficient without an
 * image encoding library as a dependency.
 */
function buildGrayscaleJpeg(width: number, height: number): Uint8Array {
  const soi = Buffer.from([0xff, 0xd8]);

  const sof0Payload = Buffer.alloc(6);
  sof0Payload[0] = 8; // precision
  sof0Payload.writeUInt16BE(height, 1);
  sof0Payload.writeUInt16BE(width, 3);
  sof0Payload[5] = 1; // number of components (grayscale)
  const component = Buffer.from([1, 0x11, 0]); // id, sampling factors, quant table id
  const sof0Body = Buffer.concat([sof0Payload, component]);
  const sof0Length = Buffer.alloc(2);
  sof0Length.writeUInt16BE(sof0Body.length + 2, 0);
  const sof0 = Buffer.concat([Buffer.from([0xff, 0xc0]), sof0Length, sof0Body]);

  const sosBody = Buffer.from([1, 1, 0, 0, 63, 0]); // 1 component scan, spectral 0-63
  const sosLength = Buffer.alloc(2);
  sosLength.writeUInt16BE(sosBody.length + 2, 0);
  const sos = Buffer.concat([Buffer.from([0xff, 0xda]), sosLength, sosBody]);

  const scanData = Buffer.from([0x00, 0x01, 0x02, 0x03]);
  const eoi = Buffer.from([0xff, 0xd9]);

  return new Uint8Array(Buffer.concat([soi, sof0, sos, scanData, eoi]));
}

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

  test("renders landscape A4 (page wider than it is tall)", async () => {
    const quiz = buildQuizContentFixture({ locale: "nl" });

    const buffer = await renderPictureHandoutPdf(quiz);

    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    expect(viewport.width).toBeGreaterThan(viewport.height);
  });

  test("stays on one page with a wide JPEG image", async () => {
    const quiz = buildQuizContentFixture({
      locale: "nl",
      image: buildGrayscaleJpeg(800, 100),
    });

    const buffer = await renderPictureHandoutPdf(quiz);
    await writeScratch("picture-handout-nl-wide-jpeg.pdf", buffer);

    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    expect(pdf.numPages).toBe(1);
  });

  test("stays on one page with a tall PNG image", async () => {
    const quiz = buildQuizContentFixture({
      locale: "nl",
      image: buildGrayscalePng(100, 800),
    });

    const buffer = await renderPictureHandoutPdf(quiz);
    await writeScratch("picture-handout-nl-tall-png.pdf", buffer);

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
