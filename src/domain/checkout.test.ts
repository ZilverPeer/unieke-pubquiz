import { describe, expect, test } from "vitest";
import { downloadMetaKey } from "./checkout";

describe("downloadMetaKey", () => {
  test("builds the line item meta_data key for one Deliverable file", () => {
    expect(downloadMetaKey("quizmaster.pdf")).toBe("pubquiz_download_quizmaster.pdf");
  });

  test("is distinct per Deliverable file", () => {
    const keys = new Set(
      (["quizmaster.pdf", "picture-handout.pdf", "answer-sheet.pdf", "music-round.mp3"] as const).map(
        downloadMetaKey,
      ),
    );
    expect(keys.size).toBe(4);
  });
});
