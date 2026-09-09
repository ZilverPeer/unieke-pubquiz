import { describe, expect, it } from "vitest";
import { validatePictureItem, type PictureItemFormInput } from "./validate-picture";

const VALID_SUBSUBCATEGORY_ID = "42";
const validIds = new Set([VALID_SUBSUBCATEGORY_ID]);

function validFile(overrides: Partial<{ type: string; size: number }> = {}): File {
  const type = overrides.type ?? "image/png";
  const size = overrides.size ?? 1024;
  return new File([new Uint8Array(size)], "picture.png", { type });
}

function baseInput(overrides: Partial<PictureItemFormInput> = {}): PictureItemFormInput {
  return {
    subsubcategoryId: VALID_SUBSUBCATEGORY_ID,
    difficulty: "medium",
    nl: { answer: "Antwoord", fact: "" },
    en: { answer: "", fact: "" },
    file: validFile(),
    fileRequired: true,
    ...overrides,
  };
}

describe("validatePictureItem", () => {
  it("accepts a complete nl-only Item with a file", () => {
    expect(validatePictureItem(baseInput(), validIds)).toBeNull();
  });

  it("accepts both Locales complete", () => {
    const input = baseInput({ en: { answer: "Answer", fact: "" } });
    expect(validatePictureItem(input, validIds)).toBeNull();
  });

  it("refuses an unknown Subsubcategory", () => {
    const errors = validatePictureItem(baseInput({ subsubcategoryId: "999" }), validIds);
    expect(errors).toEqual({ subsubcategoryId: "items.errors.subsubcategoryRequired" });
  });

  it("refuses an out-of-enum Difficulty", () => {
    const errors = validatePictureItem(baseInput({ difficulty: "expert" }), validIds);
    expect(errors).toEqual({ difficulty: "items.errors.difficultyRequired" });
  });

  it("refuses a Locale with a Fact but no Answer", () => {
    const errors = validatePictureItem(baseInput({ en: { answer: "", fact: "Weird fact" } }), validIds);
    expect(errors).toEqual({ "en.answer": "items.errors.localeIncomplete" });
  });

  it("refuses both Locales empty", () => {
    const errors = validatePictureItem(
      baseInput({ nl: { answer: "", fact: "" }, en: { answer: "", fact: "" } }),
      validIds,
    );
    expect(errors).toEqual({ translations: "items.errors.atLeastOneLocaleRequired" });
  });

  it("requires a file on create", () => {
    const errors = validatePictureItem(baseInput({ file: null, fileRequired: true }), validIds);
    expect(errors).toEqual({ file: "pictureItems.errors.file.required" });
  });

  it("allows no file on update", () => {
    const errors = validatePictureItem(baseInput({ file: null, fileRequired: false }), validIds);
    expect(errors).toBeNull();
  });

  it("refuses a file with a disallowed MIME type", () => {
    const errors = validatePictureItem(baseInput({ file: validFile({ type: "text/plain" }) }), validIds);
    expect(errors).toEqual({ file: "pictureItems.errors.file.type" });
  });

  it("refuses a file over the bucket size limit", () => {
    const errors = validatePictureItem(
      baseInput({ file: validFile({ size: 5 * 1024 * 1024 + 1 }) }),
      validIds,
    );
    expect(errors).toEqual({ file: "pictureItems.errors.file.size" });
  });

  it("accepts a file at exactly the bucket size limit", () => {
    const errors = validatePictureItem(baseInput({ file: validFile({ size: 5 * 1024 * 1024 }) }), validIds);
    expect(errors).toBeNull();
  });
});
