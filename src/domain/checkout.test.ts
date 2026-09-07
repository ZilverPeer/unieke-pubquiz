import { describe, expect, test } from "vitest";
import { downloadMetaKey } from "./checkout";

describe("downloadMetaKey", () => {
  test("builds the line item meta_data key for one Deliverable file, sequence 1-based", () => {
    expect(downloadMetaKey(0, "quizmaster.pdf")).toBe("pubquiz_download_1_quizmaster.pdf");
    expect(downloadMetaKey(1, "quizmaster.pdf")).toBe("pubquiz_download_2_quizmaster.pdf");
  });

  test("is distinct per Deliverable file", () => {
    const keys = new Set(
      (["quizmaster.pdf", "picture-handout.pdf", "answer-sheet.pdf", "music-round.mp3"] as const).map((file) =>
        downloadMetaKey(0, file),
      ),
    );
    expect(keys.size).toBe(4);
  });

  test("is distinct per sequence for the same file, so quantity above one doesn't clobber links", () => {
    const keys = new Set([0, 1, 2].map((sequence) => downloadMetaKey(sequence, "quizmaster.pdf")));
    expect(keys.size).toBe(3);
  });

  test("rejects a negative or non-integer sequence", () => {
    expect(() => downloadMetaKey(-1, "quizmaster.pdf")).toThrow(RangeError);
    expect(() => downloadMetaKey(1.5, "quizmaster.pdf")).toThrow(RangeError);
  });
});
