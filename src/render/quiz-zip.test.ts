/**
 * Unit test for buildQuizZip (ticket #73): unzips the render output and
 * asserts the four entry names and non-empty sizes. Renderers are never
 * mocked elsewhere in this module -- this test doesn't call them either,
 * it only checks the zip step itself against hand-built buffers.
 */
import { unzipSync } from "fflate";
import { describe, expect, test } from "vitest";
import { buildQuizZip } from "./quiz-zip";

describe("buildQuizZip", () => {
  test("zips the four Deliverables under their fixed names, each with a non-empty size", () => {
    const files = {
      "quizmaster.pdf": Buffer.from("quizmaster-bytes"),
      "picture-handout.pdf": Buffer.from("picture-handout-bytes"),
      "answer-sheet.pdf": Buffer.from("answer-sheet-bytes"),
      "music-round.mp3": Buffer.from("music-round-bytes"),
    };

    const zip = buildQuizZip(files);
    const entries = unzipSync(zip);

    expect(Object.keys(entries).sort()).toEqual(
      ["answer-sheet.pdf", "music-round.mp3", "picture-handout.pdf", "quizmaster.pdf"].sort(),
    );
    for (const [name, bytes] of Object.entries(entries)) {
      expect(bytes.length, `${name} should be non-empty`).toBeGreaterThan(0);
    }
  });

  test("round-trips each entry's exact bytes", () => {
    const files = {
      "quizmaster.pdf": Buffer.from("A"),
      "picture-handout.pdf": Buffer.from("B"),
      "answer-sheet.pdf": Buffer.from("C"),
      "music-round.mp3": Buffer.from("D"),
    };

    const entries = unzipSync(buildQuizZip(files));

    expect(Buffer.from(entries["quizmaster.pdf"]).toString()).toBe("A");
    expect(Buffer.from(entries["picture-handout.pdf"]).toString()).toBe("B");
    expect(Buffer.from(entries["answer-sheet.pdf"]).toString()).toBe("C");
    expect(Buffer.from(entries["music-round.mp3"]).toString()).toBe("D");
  });
});
