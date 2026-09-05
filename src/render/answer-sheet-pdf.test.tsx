import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, test } from "vitest";
import { buildQuizContentFixture } from "@/domain/fixtures";
import { renderAnswerSheetPdf } from "./answer-sheet-pdf";

const scratchDir = path.join(process.cwd(), ".scratch");

async function writeScratch(name: string, buffer: Buffer): Promise<string> {
  fs.mkdirSync(scratchDir, { recursive: true });
  const filePath = path.join(scratchDir, name);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

describe("renderAnswerSheetPdf", () => {
  test("renders exactly one A4 page", async () => {
    const quiz = buildQuizContentFixture({ locale: "nl" });

    const buffer = await renderAnswerSheetPdf(quiz);
    await writeScratch("answer-sheet-nl.pdf", buffer);

    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");

    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    expect(pdf.numPages).toBe(1);
  });

  test("contains the six Text Round names and the Music Round heading in nl", async () => {
    const quiz = buildQuizContentFixture({ locale: "nl" });

    const buffer = await renderAnswerSheetPdf(quiz);
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });

    for (let n = 1; n <= 6; n++) {
      expect(text).toContain(`Ronde ${n}: Categorie ${n}`);
    }
    expect(text).toContain("Muziekronde: Categorie 8");
    expect(text).toContain("Antwoordblad");
    expect(text).toContain("Teamnaam");
    expect(text).toContain("Artiest");
    expect(text).toContain("Titel");
  });

  test("every one of the seven sections has 10 numbered answer lines", async () => {
    const quiz = buildQuizContentFixture({ locale: "nl" });

    const buffer = await renderAnswerSheetPdf(quiz);
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });

    // Six Text Round sections (10 lines each) + one Music Round section (10
    // rows) each contain a line numbered "10." — a missing section's lines
    // would drop this count below 7.
    const tenOccurrences = text.match(/\b10\./g) ?? [];
    expect(tenOccurrences.length).toBe(7);
  });

  test("en render contains no Dutch label or heading text, and vice versa", async () => {
    const nlQuiz = buildQuizContentFixture({ locale: "nl" });
    const enQuiz = buildQuizContentFixture({ locale: "en" });

    const nlBuffer = await renderAnswerSheetPdf(nlQuiz);
    const enBuffer = await renderAnswerSheetPdf(enQuiz);
    await writeScratch("answer-sheet-en.pdf", enBuffer);

    const nlText = (
      await extractText(await getDocumentProxy(new Uint8Array(nlBuffer)), { mergePages: true })
    ).text;
    const enText = (
      await extractText(await getDocumentProxy(new Uint8Array(enBuffer)), { mergePages: true })
    ).text;

    const dutchWords = ["Ronde", "Muziekronde", "Antwoordblad", "Teamnaam", "Artiest", "Titel", "Categorie "];
    const englishWords = [
      "Round ",
      "Music Round",
      "Answer sheet",
      "Team name",
      "Artist",
      "Title",
      "Category ",
    ];

    for (const word of dutchWords) {
      expect(enText).not.toContain(word);
    }
    for (const word of englishWords) {
      expect(nlText).not.toContain(word);
    }
  });

  test("source contains no inline label literals; labels come from the message file", () => {
    const sourceFiles = [
      fileURLToPath(new URL("./answer-sheet-pdf.tsx", import.meta.url)),
      fileURLToPath(new URL("./answer-sheet/TextRoundSection.tsx", import.meta.url)),
      fileURLToPath(new URL("./answer-sheet/MusicRoundSection.tsx", import.meta.url)),
    ];
    const forbiddenWords = [
      "Ronde",
      "Muziekronde",
      "Antwoordblad",
      "Teamnaam",
      "Artiest",
      "Titel",
      "Round",
      "Music Round",
      "Answer sheet",
      "Team name",
      "Artist",
      "Title",
    ];

    for (const filePath of sourceFiles) {
      const source = fs.readFileSync(filePath, "utf8");
      for (const word of forbiddenWords) {
        expect(source).not.toContain(`"${word}`);
        expect(source).not.toContain(`'${word}`);
      }
    }
  });
});
