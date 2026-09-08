import { describe, expect, test } from "vitest";
import { downloadPath, orderWideQuizSequence, quizZipFilename } from "./orders";

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

describe("orderWideQuizSequence", () => {
  test("returns a Quiz's 0-based position among its order's Quiz ids", () => {
    const orderedQuizIds = ["quiz-a", "quiz-b", "quiz-c"];
    expect(orderWideQuizSequence("quiz-a", orderedQuizIds)).toBe(0);
    expect(orderWideQuizSequence("quiz-b", orderedQuizIds)).toBe(1);
    expect(orderWideQuizSequence("quiz-c", orderedQuizIds)).toBe(2);
  });

  test("two Quizzes on two different line items (each quizzes.sequence 0) get distinct order-wide numbers", () => {
    // Mirrors the bug this fixes: quizzes.sequence restarts at 0 per line
    // item, so two Quizzes on two different line items both have sequence
    // 0 -- orderWideQuizSequence must not be that value, it must be their
    // distinct position in the order's own Quiz list.
    const orderedQuizIds = ["quiz-line-item-1", "quiz-line-item-2"];
    expect(orderWideQuizSequence("quiz-line-item-1", orderedQuizIds)).toBe(0);
    expect(orderWideQuizSequence("quiz-line-item-2", orderedQuizIds)).toBe(1);
  });

  test("throws when the Quiz id isn't among the given order's Quiz ids", () => {
    expect(() => orderWideQuizSequence("quiz-x", ["quiz-a", "quiz-b"])).toThrow(/quiz-x/);
  });
});
