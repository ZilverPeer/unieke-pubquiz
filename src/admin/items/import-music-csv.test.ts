/**
 * Unit tests for the Music Item bulk import CSV parser (spec 4, ticket
 * #96). No database access, no zip -- see import-music-csv.ts's own
 * docblock for why `file` is never itself checked for real content here.
 */
import { describe, expect, it } from "vitest";
import { MUSIC_ITEM_IMPORT_HEADER, musicCsvColumnForField, parseMusicItemsCsv } from "./import-music-csv";

const VALID_IDS = new Set(["1"]);

function csv(...rows: string[]): string {
  return [MUSIC_ITEM_IMPORT_HEADER.join(","), ...rows].join("\n");
}

describe("parseMusicItemsCsv", () => {
  it("rejects a header that does not match exactly", () => {
    const text = "file,subsubcategoryId,difficulty\nsong.mp3,1,medium";
    const result = parseMusicItemsCsv(text, VALID_IDS);
    expect(result).toEqual({ ok: false, errors: [{ row: 0, field: "header", message: "musicImport.errors.header" }] });
  });

  it("parses two valid rows with file names and locales", () => {
    const text = csv(
      "song-one.mp3,1,medium,The Testers,First Song,5,25,nl",
      "song-two.mp3,1,easy,The Testers,Second Song,10,40,nl;en",
    );
    const result = parseMusicItemsCsv(text, VALID_IDS);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.rows).toEqual([
      {
        file: "song-one.mp3",
        subsubcategoryId: "1",
        difficulty: "medium",
        artist: "The Testers",
        title: "First Song",
        startSeconds: 5,
        endSeconds: 25,
        translations: { nl: {} },
      },
      {
        file: "song-two.mp3",
        subsubcategoryId: "1",
        difficulty: "easy",
        artist: "The Testers",
        title: "Second Song",
        startSeconds: 10,
        endSeconds: 40,
        translations: { nl: {}, en: {} },
      },
    ]);
  });

  it("reports end before start on the field validateMusicItem names, on the right row", () => {
    const text = csv(
      "song-one.mp3,1,medium,The Testers,First Song,5,25,nl",
      "song-two.mp3,1,medium,The Testers,Second Song,30,20,nl",
    );
    const result = parseMusicItemsCsv(text, VALID_IDS);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors).toEqual([{ row: 2, field: "endSeconds", message: "musicItems.errors.range.order" }]);
  });

  it("rejects a locales value that is not nl, en or nl;en", () => {
    const text = csv("song-one.mp3,1,medium,The Testers,First Song,5,25,fr");
    const result = parseMusicItemsCsv(text, VALID_IDS);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors).toEqual([{ row: 1, field: "locales", message: "musicImport.errors.locales" }]);
  });

  it("rejects a file over the row limit before validating any row", () => {
    const rows = Array.from({ length: 51 }, (_, i) => `song-${i}.mp3,1,medium,The Testers,Song ${i},5,25,nl`);
    const result = parseMusicItemsCsv(csv(...rows), VALID_IDS);
    expect(result).toEqual({ ok: false, errors: [{ row: 0, field: "file", message: "musicImport.errors.tooManyRows" }] });
  });

  it("maps a field key to its CSV column, and returns null for a field with no column", () => {
    expect(musicCsvColumnForField("endSeconds")).toBe("endSeconds");
    expect(musicCsvColumnForField("artist")).toBe("artist");
    expect(musicCsvColumnForField("translations")).toBe("locales");
    expect(musicCsvColumnForField("nonsense")).toBeNull();
  });
});
