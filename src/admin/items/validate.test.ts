import { describe, expect, it } from "vitest";
import { validateTextItem, type TextItemFormInput } from "./validate";

const VALID_SUBSUBCATEGORY_ID = "42";
const validIds = new Set([VALID_SUBSUBCATEGORY_ID]);

function baseInput(overrides: Partial<TextItemFormInput> = {}): TextItemFormInput {
  return {
    subsubcategoryId: VALID_SUBSUBCATEGORY_ID,
    difficulty: "medium",
    nl: { question: "Vraag?", answer: "Antwoord", fact: "" },
    en: { question: "", answer: "", fact: "" },
    ...overrides,
  };
}

describe("validateTextItem", () => {
  it("accepts a complete nl-only Item", () => {
    expect(validateTextItem(baseInput(), validIds)).toBeNull();
  });

  it("accepts both Locales complete", () => {
    const input = baseInput({ en: { question: "Question?", answer: "Answer", fact: "" } });
    expect(validateTextItem(input, validIds)).toBeNull();
  });

  it("refuses an unknown Subsubcategory", () => {
    const errors = validateTextItem(baseInput({ subsubcategoryId: "999" }), validIds);
    expect(errors).toEqual({ subsubcategoryId: "items.errors.subsubcategoryRequired" });
  });

  it("refuses a missing Subsubcategory", () => {
    const errors = validateTextItem(baseInput({ subsubcategoryId: "" }), validIds);
    expect(errors).toEqual({ subsubcategoryId: "items.errors.subsubcategoryRequired" });
  });

  it("refuses an out-of-enum Difficulty", () => {
    const errors = validateTextItem(baseInput({ difficulty: "expert" }), validIds);
    expect(errors).toEqual({ difficulty: "items.errors.difficultyRequired" });
  });

  it("refuses a half-filled Locale (answer only)", () => {
    const errors = validateTextItem(
      baseInput({ en: { question: "", answer: "Answer only", fact: "" } }),
      validIds,
    );
    expect(errors).toEqual({ "en.question": "items.errors.localeIncomplete" });
  });

  it("refuses a half-filled Locale (question only)", () => {
    const errors = validateTextItem(
      baseInput({ en: { question: "Question only", answer: "", fact: "" } }),
      validIds,
    );
    expect(errors).toEqual({ "en.answer": "items.errors.localeIncomplete" });
  });

  it("refuses both Locales empty", () => {
    const errors = validateTextItem(
      baseInput({ nl: { question: "", answer: "", fact: "" }, en: { question: "", answer: "", fact: "" } }),
      validIds,
    );
    expect(errors).toEqual({ translations: "items.errors.atLeastOneLocaleRequired" });
  });

  it("accepts an optional Fact", () => {
    const input = baseInput({ nl: { question: "Q", answer: "A", fact: "Interesting fact" } });
    expect(validateTextItem(input, validIds)).toBeNull();
  });
});
