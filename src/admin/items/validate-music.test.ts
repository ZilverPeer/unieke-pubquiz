import { describe, expect, it } from "vitest";
import { validateMusicItem, type MusicItemFormInput } from "./validate-music";

const VALID_SUBSUBCATEGORY_ID = "42";
const validIds = new Set([VALID_SUBSUBCATEGORY_ID]);

function baseInput(overrides: Partial<MusicItemFormInput> = {}): MusicItemFormInput {
  return {
    subsubcategoryId: VALID_SUBSUBCATEGORY_ID,
    difficulty: "medium",
    artist: "The Testers",
    title: "Unit Test Blues",
    nlChecked: true,
    enChecked: false,
    startSeconds: "5",
    endSeconds: "25",
    file: { type: "audio/mpeg", size: 1_000_000 },
    ...overrides,
  };
}

describe("validateMusicItem", () => {
  it("accepts a complete create input", () => {
    expect(validateMusicItem(baseInput(), validIds, { fileRequired: true })).toBeNull();
  });

  it("refuses an unknown Subsubcategory", () => {
    const errors = validateMusicItem(baseInput({ subsubcategoryId: "999" }), validIds, { fileRequired: true });
    expect(errors).toEqual({ subsubcategoryId: "items.errors.subsubcategoryRequired" });
  });

  it("refuses an out-of-enum Difficulty", () => {
    const errors = validateMusicItem(baseInput({ difficulty: "expert" }), validIds, { fileRequired: true });
    expect(errors).toEqual({ difficulty: "items.errors.difficultyRequired" });
  });

  it("refuses an empty artist", () => {
    const errors = validateMusicItem(baseInput({ artist: "  " }), validIds, { fileRequired: true });
    expect(errors).toEqual({ artist: "musicItems.errors.artist.required" });
  });

  it("refuses an empty title", () => {
    const errors = validateMusicItem(baseInput({ title: "" }), validIds, { fileRequired: true });
    expect(errors).toEqual({ title: "musicItems.errors.title.required" });
  });

  it("refuses when no Locale is ticked", () => {
    const errors = validateMusicItem(baseInput({ nlChecked: false, enChecked: false }), validIds, {
      fileRequired: true,
    });
    expect(errors).toEqual({ translations: "musicItems.errors.translations.atLeastOneLocaleRequired" });
  });

  it("requires a file on create", () => {
    const errors = validateMusicItem(baseInput({ file: null }), validIds, { fileRequired: true });
    expect(errors).toEqual({ file: "musicItems.errors.file.required" });
  });

  it("allows a missing file on update", () => {
    const errors = validateMusicItem(
      baseInput({ file: null, startSeconds: "", endSeconds: "" }),
      validIds,
      { fileRequired: false },
    );
    expect(errors).toBeNull();
  });

  it("requires start and end when a file is given on update", () => {
    const errors = validateMusicItem(
      baseInput({ startSeconds: "", endSeconds: "" }),
      validIds,
      { fileRequired: false },
    );
    expect(errors).toEqual({ endSeconds: "musicItems.errors.range.order" });
  });

  it("refuses start after end", () => {
    const errors = validateMusicItem(baseInput({ startSeconds: "30", endSeconds: "20" }), validIds, {
      fileRequired: true,
    });
    expect(errors).toEqual({ endSeconds: "musicItems.errors.range.order" });
  });

  it("refuses a clip shorter than the minimum", () => {
    const errors = validateMusicItem(baseInput({ startSeconds: "0", endSeconds: "5" }), validIds, {
      fileRequired: true,
    });
    expect(errors).toEqual({ endSeconds: "musicItems.errors.range.length" });
  });

  it("refuses a clip longer than the maximum", () => {
    const errors = validateMusicItem(baseInput({ startSeconds: "0", endSeconds: "50" }), validIds, {
      fileRequired: true,
    });
    expect(errors).toEqual({ endSeconds: "musicItems.errors.range.length" });
  });

  it("refuses a disallowed MIME type", () => {
    const errors = validateMusicItem(
      baseInput({ file: { type: "text/plain", size: 1000 } }),
      validIds,
      { fileRequired: true },
    );
    expect(errors).toEqual({ file: "musicItems.errors.file.type" });
  });

  it("refuses a file over the size limit", () => {
    const errors = validateMusicItem(
      baseInput({ file: { type: "audio/mpeg", size: 21 * 1024 * 1024 } }),
      validIds,
      { fileRequired: true },
    );
    expect(errors).toEqual({ file: "musicItems.errors.file.size" });
  });
});
