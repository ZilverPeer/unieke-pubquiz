import { describe, expect, it } from "vitest";
import { parsePictureItemsCsv, PICTURE_ITEM_IMPORT_HEADER, pictureCsvColumnForField } from "./import-picture-csv";

const VALID_ID = "42";
const knownIds = new Set([VALID_ID]);

const HEADER_LINE = PICTURE_ITEM_IMPORT_HEADER.join(",");

function csvRow(overrides: Partial<Record<(typeof PICTURE_ITEM_IMPORT_HEADER)[number], string>> = {}): string {
  const fields = {
    file: "photo.jpg",
    subsubcategoryId: VALID_ID,
    difficulty: "medium",
    answer_nl: "Antwoord",
    fact_nl: "",
    answer_en: "",
    fact_en: "",
    ...overrides,
  };
  return PICTURE_ITEM_IMPORT_HEADER.map((key) => fields[key]).join(",");
}

describe("parsePictureItemsCsv", () => {
  it("refuses a wrong header", () => {
    const text = `file,subsubcategoryId,difficulty\n${"photo.jpg"},${VALID_ID},medium`;
    const result = parsePictureItemsCsv(text, knownIds);
    expect(result).toEqual({ ok: false, errors: [{ row: 0, field: "header", message: "pictureImport.errors.header" }] });
  });

  it("parses three valid rows with their file names", () => {
    const text = [
      HEADER_LINE,
      csvRow({ file: "a.jpg" }),
      csvRow({ file: "b.png" }),
      csvRow({ file: "c.jpeg" }),
    ].join("\n");
    const result = parsePictureItemsCsv(text, knownIds);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((row) => row.file)).toEqual(["a.jpg", "b.png", "c.jpeg"]);
    expect(result.rows[0]).toEqual({
      file: "a.jpg",
      subsubcategoryId: VALID_ID,
      difficulty: "medium",
      translations: { nl: { answer: "Antwoord", fact: undefined } },
    });
  });

  it("reports a bad Difficulty on row 2 and returns no rows", () => {
    const text = [HEADER_LINE, csvRow(), csvRow({ difficulty: "extreme" }), csvRow()].join("\n");
    const result = parsePictureItemsCsv(text, knownIds);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors).toEqual([{ row: 2, field: "difficulty", message: "items.errors.difficultyRequired" }]);
  });

  it("refuses an over-limit file before validation", () => {
    const rows = Array.from({ length: 201 }, (_, i) => (i === 0 ? csvRow({ difficulty: "bogus" }) : csvRow()));
    const text = [HEADER_LINE, ...rows].join("\n");
    const result = parsePictureItemsCsv(text, knownIds);
    expect(result).toEqual({
      ok: false,
      errors: [{ row: 0, field: "file", message: "pictureImport.errors.tooManyRows" }],
    });
  });

  it("reports an empty file column", () => {
    const text = [HEADER_LINE, csvRow({ file: "" })].join("\n");
    const result = parsePictureItemsCsv(text, knownIds);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors).toEqual([{ row: 1, field: "file", message: "pictureImport.errors.fileMissing" }]);
  });
});

describe("pictureCsvColumnForField", () => {
  it("maps nl.answer to answer_nl and file to file", () => {
    expect(pictureCsvColumnForField("nl.answer")).toBe("answer_nl");
    expect(pictureCsvColumnForField("file")).toBe("file");
  });

  it("returns null for a key with no single CSV column", () => {
    expect(pictureCsvColumnForField("translations")).toBeNull();
    expect(pictureCsvColumnForField("header")).toBeNull();
  });
});
