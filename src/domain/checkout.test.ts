import { describe, expect, test } from "vitest";
import { downloadMetaKey } from "./checkout";

describe("downloadMetaKey", () => {
  test("builds the line item meta_data key for one Quiz's zip, sequence 1-based", () => {
    expect(downloadMetaKey(0)).toBe("pubquiz_download_1");
    expect(downloadMetaKey(1)).toBe("pubquiz_download_2");
  });

  test("is distinct per sequence, so quantity above one doesn't clobber links", () => {
    const keys = new Set([0, 1, 2].map((sequence) => downloadMetaKey(sequence)));
    expect(keys.size).toBe(3);
  });

  test("rejects a negative or non-integer sequence", () => {
    expect(() => downloadMetaKey(-1)).toThrow(RangeError);
    expect(() => downloadMetaKey(1.5)).toThrow(RangeError);
  });
});
