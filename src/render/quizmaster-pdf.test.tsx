import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, test } from "vitest";
import { buildQuizContentFixture } from "@/domain";
import { renderQuizmasterPdf } from "./quizmaster-pdf";

describe("renderQuizmasterPdf", () => {
  test("renders a complete nl Quiz to a PDF buffer with 8 pages", async () => {
    const quiz = buildQuizContentFixture({ locale: "nl" });

    const buffer = await renderQuizmasterPdf(quiz);

    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    expect(pdf.numPages).toBe(8);
  });

  test("extracted text contains fixture questions, answers, facts, picture answers and music details", async () => {
    const quiz = buildQuizContentFixture({ locale: "nl" });

    const buffer = await renderQuizmasterPdf(quiz);
    const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });

    expect(text).toContain("Fixturevraag 1 over Categorie 1?");
    expect(text).toContain("Fixtureantwoord 1");
    expect(text).toContain("Fixtureweetje 7");
    // Picture Round is slot 6 (items 61-70); item 66 has an answer.
    expect(text).toContain("Fixtureantwoord 66");
    // Music Round is slot 7 (items 71-80); item 71's artist and title.
    expect(text).toContain("Fixture Artist 1");
    expect(text).toContain("Fixture Track 71");
  });

  test("no page contains a page-number footer", async () => {
    const quiz = buildQuizContentFixture({ locale: "nl" });

    const buffer = await renderQuizmasterPdf(quiz);
    const { text } = await extractText(new Uint8Array(buffer), { mergePages: false });

    for (const pageText of text) {
      const lines = pageText.split("\n").map((line) => line.trim());
      for (const line of lines) {
        expect(line).not.toMatch(/^\d+ \/ \d+$/);
      }
    }
  });

  test("headings and labels for nl come from the nl message file", async () => {
    const quiz = buildQuizContentFixture({ locale: "nl" });

    const buffer = await renderQuizmasterPdf(quiz);
    const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });

    expect(text).toContain("Ronde 1: Categorie 1");
    expect(text).toContain("Beeldronde: Categorie 7");
    expect(text).toContain("Muziekronde: Categorie 8");
    expect(text).toContain("Vraag");
    expect(text).toContain("Antwoord");
    expect(text).toContain("Weetje");
    expect(text).toContain("Artiest");
    expect(text).toContain("Titel");
  });

  test("en render contains no nl message strings, and nl render contains no en message strings", async () => {
    const nlQuiz = buildQuizContentFixture({ locale: "nl" });
    const enQuiz = buildQuizContentFixture({ locale: "en" });

    const nlBuffer = await renderQuizmasterPdf(nlQuiz);
    const enBuffer = await renderQuizmasterPdf(enQuiz);
    const { text: nlText } = await extractText(new Uint8Array(nlBuffer), { mergePages: true });
    const { text: enText } = await extractText(new Uint8Array(enBuffer), { mergePages: true });

    const nlWords = [
      "Ronde",
      "Beeldronde",
      "Muziekronde",
      "Vraag",
      "Antwoord",
      "Weetje",
      "Artiest",
      "Titel",
      "Categorie ",
    ];
    const enWords = [
      "Round ",
      "Picture Round",
      "Music Round",
      "Question",
      "Answer",
      "Fact",
      // Music artist/title are language-neutral fixture literals ("Fixture Artist ...",
      // "Fixture Track ..."), so check the labelled form to avoid a false positive there.
      "Artist:",
      "Title:",
      "Category ",
    ];

    for (const word of nlWords) {
      expect(enText).not.toContain(word);
    }
    for (const word of enWords) {
      expect(nlText).not.toContain(word);
    }
  });

  test("the renderer source contains no Dutch or English label literals", () => {
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "quizmaster-pdf.tsx"),
      "utf8",
    );

    const forbidden = [
      "Ronde",
      "Beeldronde",
      "Muziekronde",
      "Vraag",
      "Antwoord",
      "Weetje",
      "Artiest",
      "Titel",
      "Round",
      "Picture Round",
      "Music Round",
      "Question",
      "Answer",
      "Fact",
      "Artist",
      "Title",
    ];

    for (const word of forbidden) {
      expect(source).not.toContain(`"${word}`);
      expect(source).not.toContain(`'${word}`);
    }
  });
});
