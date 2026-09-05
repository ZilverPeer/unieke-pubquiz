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
});
