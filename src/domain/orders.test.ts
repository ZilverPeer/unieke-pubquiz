import { describe, expect, test } from "vitest";
import { downloadPath, quizZipFilename } from "./orders";

describe("downloadPath", () => {
  test("builds the app download route for a Quiz's zip, given a token", () => {
    expect(downloadPath("abc123", "quiz.zip")).toBe("/download/abc123/quiz.zip");
  });

  test("uses the token given, whatever it is", () => {
    expect(downloadPath("tok", "quiz.zip")).toBe("/download/tok/quiz.zip");
  });
});

describe("quizZipFilename", () => {
  test("builds pubquiz-<order number>-<sequence + 1>-<locale>.zip", () => {
    expect(quizZipFilename(101, 0, "nl")).toBe("pubquiz-101-1-nl.zip");
  });

  test("sequence is 1-based in the file name", () => {
    expect(quizZipFilename(101, 1, "nl")).toBe("pubquiz-101-2-nl.zip");
    expect(quizZipFilename(101, 2, "nl")).toBe("pubquiz-101-3-nl.zip");
  });

  test("carries the locale verbatim", () => {
    expect(quizZipFilename(42, 0, "en")).toBe("pubquiz-42-1-en.zip");
  });

  test("is distinct per sequence for the same order, so a multi-quiz order's zips don't collide", () => {
    const names = new Set([0, 1, 2].map((sequence) => quizZipFilename(7, sequence, "nl")));
    expect(names.size).toBe(3);
  });
});
