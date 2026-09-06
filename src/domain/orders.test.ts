import { describe, expect, test } from "vitest";
import { downloadPath } from "./orders";

describe("downloadPath", () => {
  test("builds the app download route for one Deliverable, given a token and file", () => {
    expect(downloadPath("abc123", "quizmaster.pdf")).toBe("/download/abc123/quizmaster.pdf");
  });

  test("uses the same token for every Deliverable file of one Quiz", () => {
    expect(downloadPath("tok", "picture-handout.pdf")).toBe("/download/tok/picture-handout.pdf");
    expect(downloadPath("tok", "answer-sheet.pdf")).toBe("/download/tok/answer-sheet.pdf");
    expect(downloadPath("tok", "music-round.mp3")).toBe("/download/tok/music-round.mp3");
  });
});
