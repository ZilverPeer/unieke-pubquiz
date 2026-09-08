import { describe, expect, test } from "vitest";
import { parsePidFileContents, serializePid } from "./pidfile";

/**
 * Unit seam for ticket #59's `loop:up`/`loop:down`: the pure parse/serialize
 * pair the pid-file read/write wraps around a real file (see pidfile.ts).
 * Never imports up.ts/down.ts (they run their whole flow on import).
 */
describe("serializePid", () => {
  test("writes the pid as a bare decimal string with a trailing newline", () => {
    expect(serializePid(12345)).toBe("12345\n");
  });
});

describe("parsePidFileContents", () => {
  test("parses a bare pid", () => {
    expect(parsePidFileContents("12345\n")).toBe(12345);
  });

  test("parses a pid with no trailing newline", () => {
    expect(parsePidFileContents("12345")).toBe(12345);
  });

  test("returns null for empty contents", () => {
    expect(parsePidFileContents("")).toBeNull();
  });

  test("returns null for non-numeric contents", () => {
    expect(parsePidFileContents("not-a-pid")).toBeNull();
  });
});
