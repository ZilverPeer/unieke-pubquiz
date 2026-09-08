/**
 * Unit tests for parseGenerateArgs (no DB, no I/O).
 */
import { describe, expect, it } from "vitest";
import { parseGenerateArgs, parseScriptArgs } from "./cli-args";

describe("parseGenerateArgs", () => {
  it("parses the required flags into a QuizRequest shape", () => {
    const options = parseGenerateArgs([
      "--locale",
      "nl",
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
    expect(options.requestedDifficulty).toBe("hard");
    expect(options.billingEmail).toBe("erik@example.com");
    expect(options.seed).toBe(42);
    expect(options.out).toBe("content/generated/test-run");
    expect(options.categoryPicks).toEqual([]);
  });

  it("collects repeated --pick flags in order", () => {
    const options = parseGenerateArgs([
      "--locale",
      "en",
      "--difficulty",
      "mixed",
      "--email",
      "erik@example.com",
      "--pick",
      "3",
      "--pick",
      "5",
    ]);

    expect(options.categoryPicks).toEqual(["3", "5"]);
  });

  it("defaults seed to an integer within the 32-bit range and out to a timestamped folder under content/generated", () => {
    const options = parseGenerateArgs([
      "--locale",
      "nl",
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
      parseGenerateArgs(["--locale", "fr", "--difficulty", "mixed", "--email", "erik@example.com"]),
    ).toThrow(/--locale/);
  });

  it("throws when --locale is missing", () => {
    expect(() =>
      parseGenerateArgs(["--difficulty", "mixed", "--email", "erik@example.com"]),
    ).toThrow(/--locale/);
  });

  it("throws when more than 8 --pick flags are given", () => {
    const argv = ["--locale", "nl", "--difficulty", "mixed", "--email", "erik@example.com"];
    for (let i = 0; i < 9; i++) {
      argv.push("--pick", String(i + 1));
    }

    expect(() => parseGenerateArgs(argv)).toThrow(/at most 8/i);
  });

  it("throws when the same --pick category id is given twice", () => {
    expect(() =>
      parseGenerateArgs([
        "--locale",
        "nl",
        "--difficulty",
        "mixed",
        "--email",
        "erik@example.com",
        "--pick",
        "3",
        "--pick",
        "3",
      ]),
    ).toThrow(/distinct/i);
  });
});

describe("parseScriptArgs", () => {
  it("defaults to the generate command for existing flags", () => {
    const command = parseScriptArgs([
      "--locale",
      "nl",
      "--difficulty",
      "hard",
      "--email",
      "erik@example.com",
    ]);

    expect(command.kind).toBe("generate");
  });

  it("parses --retry-quiz <id>", () => {
    const command = parseScriptArgs(["--retry-quiz", "quiz-123"]);

    expect(command).toEqual({ kind: "retry-quiz", options: { quizId: "quiz-123" } });
  });

  it("--retry-quiz requires a value", () => {
    expect(() => parseScriptArgs(["--retry-quiz"])).toThrow('--retry-quiz requires a value');
  });

  it("--retry-quiz takes no other arguments", () => {
    expect(() => parseScriptArgs(["--retry-quiz", "quiz-123", "--out", "x"])).toThrow(
      "--retry-quiz takes no other arguments",
    );
  });

  it("parses --composition <id>", () => {
    const command = parseScriptArgs(["--composition", "comp-123"]);

    expect(command).toEqual({ kind: "composition", options: { compositionId: "comp-123" } });
  });

  it("--composition requires a value", () => {
    expect(() => parseScriptArgs(["--composition"])).toThrow('--composition requires a value');
  });

  it("--composition takes no other arguments", () => {
    expect(() => parseScriptArgs(["--composition", "comp-123", "extra"])).toThrow(
      "--composition takes no other arguments",
    );
  });
});
