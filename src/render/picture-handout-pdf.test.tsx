import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { buildQuizContentFixture } from "@/domain";
import type { QuizContent } from "@/domain";
import { extractImages, extractText, getDocumentProxy } from "unpdf";
import { describe, expect, test } from "vitest";
import { renderPictureHandoutPdf } from "./picture-handout-pdf";

const CRC_TABLE = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

/** Builds a valid, distinct 1x1 RGB PNG so image-embedding dedup can't collapse it with others. */
function makeDistinctPng(r: number, g: number, b: number): Uint8Array {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0);
  ihdrData.writeUInt32BE(1, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdr = pngChunk("IHDR", ihdrData);
  const raw = Buffer.from([0, r, g, b]);
  const idat = pngChunk("IDAT", zlib.deflateSync(raw));
  const iend = pngChunk("IEND", Buffer.alloc(0));
  return Uint8Array.from(Buffer.concat([signature, ihdr, idat, iend]));
}

/** Returns a QuizContent whose 10 Picture Round images are all pixel-distinct. */
function withDistinctPictureImages(quiz: QuizContent): QuizContent {
  return {
    ...quiz,
    rounds: quiz.rounds.map((round) => {
      if (round.kind !== "picture") return round;
      return {
        ...round,
        items: round.items.map((item, index) => {
          if (item.kind !== "picture") return item;
          return { ...item, image: makeDistinctPng(index * 20, index * 10, index * 5) };
        }),
      };
    }),
  };
}

describe("renderPictureHandoutPdf", () => {
  test("renders a one-page PDF buffer", async () => {
    const quiz = buildQuizContentFixture({ locale: "nl" });

    const buffer = await renderPictureHandoutPdf(quiz);

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

  test("isolates locale: nl output has no en labels, en output has no nl labels", async () => {
    const nlBuffer = await renderPictureHandoutPdf(buildQuizContentFixture({ locale: "nl" }));
    const enBuffer = await renderPictureHandoutPdf(buildQuizContentFixture({ locale: "en" }));

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

  // Answer lines are graphical (a bottom border, not text), so "each cell has a
  // visible answer line" is verified by visual inspection rather than assertion.
  // This writes sample output for that manual check; it is not itself a behaviour test.
  test("dev helper: writes sample nl and en PDFs to .scratch for visual review", async () => {
    fs.mkdirSync(path.join(process.cwd(), ".scratch"), { recursive: true });

    const nlBuffer = await renderPictureHandoutPdf(buildQuizContentFixture({ locale: "nl" }));
    fs.writeFileSync(path.join(process.cwd(), ".scratch", "picture-handout-nl.pdf"), nlBuffer);

    const enBuffer = await renderPictureHandoutPdf(buildQuizContentFixture({ locale: "en" }));
    fs.writeFileSync(path.join(process.cwd(), ".scratch", "picture-handout-en.pdf"), enBuffer);

    expect(nlBuffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(enBuffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });
});
