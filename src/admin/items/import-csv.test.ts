import { describe, expect, it } from "vitest";
import { csvColumnForField, parseTextItemsCsv, TEXT_ITEM_IMPORT_HEADER } from "./import-csv";

const VALID_ID = "42";
const knownIds = new Set([VALID_ID]);

const HEADER_LINE = TEXT_ITEM_IMPORT_HEADER.join(",");

function csvRow(overrides: Partial<Record<(typeof TEXT_ITEM_IMPORT_HEADER)[number], string>> = {}): string {
  const fields = {
    subsubcategoryId: VALID_ID,
    difficulty: "medium",
    question_nl: "Vraag?",
    answer_nl: "Antwoord",
    fact_nl: "",
    question_en: "",
    answer_en: "",
    fact_en: "",
    ...overrides,
  };
  return TEXT_ITEM_IMPORT_HEADER.map((key) => fields[key]).join(",");
}

describe("parseTextItemsCsv", () => {
  it("refuses a wrong header", () => {
    const text = `subsubcategoryId,difficulty,question_nl\n${VALID_ID},medium,Vraag?`;
    const result = parseTextItemsCsv(text, knownIds);
    expect(result).toEqual({ ok: false, errors: [{ row: 0, field: "header", message: "itemsImport.errors.header" }] });
  });

  it("parses three valid rows", () => {
    const text = [HEADER_LINE, csvRow(), csvRow(), csvRow()].join("\n");
    const result = parseTextItemsCsv(text, knownIds);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toEqual({
      subsubcategoryId: VALID_ID,
      difficulty: "medium",
      translations: { nl: { question: "Vraag?", answer: "Antwoord", fact: undefined } },
    });
  });

  it("reports a bad Difficulty on row 2 and returns no rows", () => {
    const text = [HEADER_LINE, csvRow(), csvRow({ difficulty: "extreme" }), csvRow()].join("\n");
    const result = parseTextItemsCsv(text, knownIds);
    expect(result).toEqual({
      ok: false,
      errors: [{ row: 2, field: "difficulty", message: "items.errors.difficultyRequired" }],
    });
  });

  it("refuses an over-limit file before validation", () => {
    const rows = Array.from({ length: 501 }, (_, i) => (i === 0 ? csvRow({ difficulty: "bogus" }) : csvRow()));
    const text = [HEADER_LINE, ...rows].join("\n");
    const result = parseTextItemsCsv(text, knownIds);
    expect(result).toEqual({
      ok: false,
      errors: [{ row: 0, field: "file", message: "itemsImport.errors.tooManyRows" }],
    });
  });

  it("parses a BOM-prefixed file", () => {
    const text = "﻿" + [HEADER_LINE, csvRow()].join("\n");
    const result = parseTextItemsCsv(text, knownIds);
    expect(result.ok).toBe(true);
  });

  it("parses a quoted field with a comma and a newline", () => {
    const text = [HEADER_LINE, csvRow({ fact_nl: '"Amsterdam, hoofdstad\nvan NL"' })].join("\n");
    const result = parseTextItemsCsv(text, knownIds);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.rows[0].translations.nl?.fact).toBe("Amsterdam, hoofdstad\nvan NL");
  });
});

describe("csvColumnForField", () => {
  it("maps every validateTextItem field key to its CSV header column", () => {
    expect(csvColumnForField("subsubcategoryId")).toBe("subsubcategoryId");
    expect(csvColumnForField("difficulty")).toBe("difficulty");
    expect(csvColumnForField("nl.question")).toBe("question_nl");
    expect(csvColumnForField("nl.answer")).toBe("answer_nl");
    expect(csvColumnForField("en.question")).toBe("question_en");
    expect(csvColumnForField("en.answer")).toBe("answer_en");
  });

  it("returns null for a key with no single CSV column", () => {
    expect(csvColumnForField("translations")).toBeNull();
    expect(csvColumnForField("header")).toBeNull();
    expect(csvColumnForField("file")).toBeNull();
  });
});
