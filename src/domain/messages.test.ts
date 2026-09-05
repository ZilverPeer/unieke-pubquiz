import { describe, expect, test } from "vitest";
import { message } from "./messages";

describe("message", () => {
  test("returns the nl round heading for slot 0", () => {
    expect(message("nl", "roundHeading1")).toBe("Ronde 1");
  });

  test("returns the en round heading for slot 0", () => {
    expect(message("en", "roundHeading1")).toBe("Round 1");
  });

  test("returns the nl label for the Picture Round", () => {
    expect(message("nl", "pictureRoundHeading")).toBe("Beeldronde");
  });

  test("returns the en label for the Picture Round", () => {
    expect(message("en", "pictureRoundHeading")).toBe("Picture Round");
  });

  test("returns the nl label for the Music Round", () => {
    expect(message("nl", "musicRoundHeading")).toBe("Muziekronde");
  });

  test("returns the en label for the Music Round", () => {
    expect(message("en", "musicRoundHeading")).toBe("Music Round");
  });

  test("returns the nl Deliverable label for the Quizmaster PDF", () => {
    expect(message("nl", "quizmasterPdfLabel")).toBe("Quizmaster-PDF");
  });

  test("throws a clear error on a missing key", () => {
    // @ts-expect-error deliberately invalid key to exercise the failure path
    expect(() => message("nl", "doesNotExist")).toThrow(
      /doesNotExist.*nl/i,
    );
  });
});
