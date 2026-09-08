import { describe, expect, it } from "vitest";
import { isAllowedOperator } from "./allowlist";

describe("isAllowedOperator", () => {
  it("allows an email that matches an entry exactly", () => {
    expect(isAllowedOperator("operator@example.com", "operator@example.com")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(isAllowedOperator("Operator@Example.com", "operator@example.com")).toBe(true);
  });

  it("tolerates whitespace around entries", () => {
    expect(isAllowedOperator("a@example.com", " a@example.com , b@example.com ")).toBe(true);
  });

  it("matches any entry in a comma-separated list", () => {
    expect(isAllowedOperator("b@example.com", "a@example.com,b@example.com,c@example.com")).toBe(true);
  });

  it("refuses an email not on the list", () => {
    expect(isAllowedOperator("nobody@example.com", "a@example.com,b@example.com")).toBe(false);
  });

  it("refuses everyone when the allowlist is empty", () => {
    expect(isAllowedOperator("a@example.com", "")).toBe(false);
  });

  it("refuses everyone when the allowlist is undefined", () => {
    expect(isAllowedOperator("a@example.com", undefined)).toBe(false);
  });

  it("refuses everyone when the allowlist is only whitespace and commas", () => {
    expect(isAllowedOperator("a@example.com", " , , ")).toBe(false);
  });

  it("refuses a null or empty email", () => {
    expect(isAllowedOperator(null, "a@example.com")).toBe(false);
    expect(isAllowedOperator("", "a@example.com")).toBe(false);
  });
});
