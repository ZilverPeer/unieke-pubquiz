/**
 * Unit tests for the pure request parser (ticket #102, spec 5). No I/O, no
 * repository -- Category id existence and pick-count/duplicate validity are
 * checked later, in check-feasibility.ts, once the repository's Category id
 * set is available (see route.ts).
 */
import { describe, expect, it } from "vitest";
import { parseFeasibilityRequest } from "./parse-request";

describe("parseFeasibilityRequest", () => {
  it("parses a well-formed body", () => {
    const body = JSON.stringify({
      billingEmail: "jane@example.com",
      lines: [{ locale: "nl", requestedDifficulty: "hard", categoryPicks: ["12"] }],
    });

    const result = parseFeasibilityRequest(body);

    expect(result).toEqual({
      billingEmail: "jane@example.com",
      lines: [{ locale: "nl", requestedDifficulty: "hard", categoryPicks: ["12"] }],
    });
  });

  it("rejects malformed JSON", () => {
    const result = parseFeasibilityRequest("{not json");
    expect(typeof result).toBe("string");
  });

  it("rejects a non-object body", () => {
    const result = parseFeasibilityRequest(JSON.stringify("hello"));
    expect(typeof result).toBe("string");
  });

  it("rejects a missing billingEmail", () => {
    const body = JSON.stringify({ lines: [] });
    const result = parseFeasibilityRequest(body);
    expect(result).toBe("billingEmail must be a non-empty string");
  });

  it("rejects an empty billingEmail", () => {
    const body = JSON.stringify({ billingEmail: "  ", lines: [] });
    const result = parseFeasibilityRequest(body);
    expect(result).toBe("billingEmail must be a non-empty string");
  });

  it("rejects a missing lines array", () => {
    const body = JSON.stringify({ billingEmail: "jane@example.com" });
    const result = parseFeasibilityRequest(body);
    expect(result).toBe("lines must be a non-empty array");
  });

  it("rejects an empty lines array", () => {
    const body = JSON.stringify({ billingEmail: "jane@example.com", lines: [] });
    const result = parseFeasibilityRequest(body);
    expect(result).toBe("lines must be a non-empty array");
  });

  it("rejects an invalid locale", () => {
    const body = JSON.stringify({
      billingEmail: "jane@example.com",
      lines: [{ locale: "fr", requestedDifficulty: "hard", categoryPicks: [] }],
    });
    const result = parseFeasibilityRequest(body);
    expect(result).toBe("line 0: locale must be one of nl, en");
  });

  it("rejects an invalid requestedDifficulty", () => {
    const body = JSON.stringify({
      billingEmail: "jane@example.com",
      lines: [{ locale: "nl", requestedDifficulty: "impossible", categoryPicks: [] }],
    });
    const result = parseFeasibilityRequest(body);
    expect(result).toBe("line 0: requestedDifficulty must be one of easy, medium, hard, mixed");
  });

  it("rejects categoryPicks that is not an array of strings", () => {
    const body = JSON.stringify({
      billingEmail: "jane@example.com",
      lines: [{ locale: "nl", requestedDifficulty: "hard", categoryPicks: [12] }],
    });
    const result = parseFeasibilityRequest(body);
    expect(result).toBe("line 0: categoryPicks must be an array of strings");
  });

  it("parses two lines independently", () => {
    const body = JSON.stringify({
      billingEmail: "jane@example.com",
      lines: [
        { locale: "nl", requestedDifficulty: "hard", categoryPicks: ["1"] },
        { locale: "en", requestedDifficulty: "mixed", categoryPicks: [] },
      ],
    });

    const result = parseFeasibilityRequest(body);

    expect(result).toEqual({
      billingEmail: "jane@example.com",
      lines: [
        { locale: "nl", requestedDifficulty: "hard", categoryPicks: ["1"] },
        { locale: "en", requestedDifficulty: "mixed", categoryPicks: [] },
      ],
    });
  });
});
