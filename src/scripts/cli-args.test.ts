/**
 * Unit tests for parseGenerateArgs (no DB, no I/O).
 */
import { describe, expect, it } from "vitest";
import { parseGenerateArgs } from "./cli-args";

describe("parseGenerateArgs", () => {
  it("parses the required flags into a QuizRequest shape", () => {
    const options = parseGenerateArgs([
      "--locale",
      "nl",
      "--mode",
      "mixed",
      "--difficulty",
      "hard",
      "--email",
      "erik@example.com",
      "--seed",
      "42",
      "--out",
      "content/generated/test-run",
    ]);

    expect(options.locale).toBe("nl");
    expect(options.quizMode).toBe("mixed");
    expect(options.requestedDifficulty).toBe("hard");
    expect(options.billingEmail).toBe("erik@example.com");
    expect(options.seed).toBe(42);
    expect(options.out).toBe("content/generated/test-run");
    expect(options.categoryPicks).toEqual(new Array(8).fill(undefined));
  });

  it("assigns repeated --pick flags to their slots", () => {
    const options = parseGenerateArgs([
      "--locale",
      "en",
      "--mode",
      "mixed",
      "--difficulty",
      "mixed",
      "--email",
      "erik@example.com",
      "--pick",
      "0=3",
      "--pick",
      "7=5",
    ]);

    const expected = new Array(8).fill(undefined);
    expected[0] = "3";
    expected[7] = "5";
    expect(options.categoryPicks).toEqual(expected);
  });

  it("defaults seed to an integer within the 32-bit range and out to a timestamped folder under content/generated", () => {
    const options = parseGenerateArgs([
      "--locale",
      "nl",
      "--mode",
      "mixed",
      "--difficulty",
      "mixed",
      "--email",
      "erik@example.com",
    ]);

    expect(Number.isInteger(options.seed)).toBe(true);
    expect(options.seed).toBeGreaterThanOrEqual(0);
    expect(options.seed).toBeLessThan(0x1_0000_0000);
    expect(options.out).toMatch(/^content[/\\]generated[/\\]\d{8}-\d{6}-nl$/);
  });

  it("throws a clear message for an invalid --locale", () => {
    expect(() =>
      parseGenerateArgs([
        "--locale",
        "fr",
        "--mode",
        "mixed",
        "--difficulty",
        "mixed",
        "--email",
        "erik@example.com",
      ]),
    ).toThrow(/--locale/);
  });

  it("throws when --mode is missing", () => {
    expect(() =>
      parseGenerateArgs(["--locale", "nl", "--difficulty", "mixed", "--email", "erik@example.com"]),
    ).toThrow(/--mode/);
  });

  it("throws when a --pick slot is out of the 0-7 range", () => {
    expect(() =>
      parseGenerateArgs([
        "--locale",
        "nl",
        "--mode",
        "mixed",
        "--difficulty",
        "mixed",
        "--email",
        "erik@example.com",
        "--pick",
        "8=3",
      ]),
    ).toThrow(/0 and 7/);
  });

  it("throws when single_category mode has no --pick", () => {
    expect(() =>
      parseGenerateArgs([
        "--locale",
        "nl",
        "--mode",
        "single_category",
        "--difficulty",
        "mixed",
        "--email",
        "erik@example.com",
      ]),
    ).toThrow(/single_category/);
  });

  it("throws when single_category mode has more than one --pick", () => {
    expect(() =>
      parseGenerateArgs([
        "--locale",
        "nl",
        "--mode",
        "single_category",
        "--difficulty",
        "mixed",
        "--email",
        "erik@example.com",
        "--pick",
        "0=1",
        "--pick",
        "1=2",
      ]),
    ).toThrow(/single_category/);
  });
});
