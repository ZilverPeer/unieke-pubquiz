import { describe, expect, test } from "vitest";
import { buildPoolFixture } from "./fixtures";

describe("buildPoolFixture", () => {
  test("builds an in-memory pool with the requested counts per kind and difficulty", () => {
    const fixture = buildPoolFixture({
      locales: ["nl", "en"],
      categories: 2,
      subsubcategoriesPerCategory: 2,
      itemsPerKindPerDifficulty: 3,
    });

    // 3 kinds x 3 difficulties x 3 items = 27
    expect(fixture.pool).toHaveLength(27);

    const textEasy = fixture.pool.filter(
      (item) => item.kind === "text" && item.difficulty === "easy",
    );
    expect(textEasy).toHaveLength(3);

    const pictureHard = fixture.pool.filter(
      (item) => item.kind === "picture" && item.difficulty === "hard",
    );
    expect(pictureHard).toHaveLength(3);

    const musicMedium = fixture.pool.filter(
      (item) => item.kind === "music" && item.difficulty === "medium",
    );
    expect(musicMedium).toHaveLength(3);
  });

  test("every pool item has a translation for every requested Locale", () => {
    const fixture = buildPoolFixture({
      locales: ["nl", "en"],
      categories: 1,
      subsubcategoriesPerCategory: 1,
      itemsPerKindPerDifficulty: 1,
    });

    for (const item of fixture.pool) {
      expect(fixture.translations.nl.has(item.id)).toBe(true);
      expect(fixture.translations.en.has(item.id)).toBe(true);
    }
  });

  test("builds the requested number of Categories and Subsubcategories per Category", () => {
    const fixture = buildPoolFixture({
      locales: ["nl"],
      categories: 3,
      subsubcategoriesPerCategory: 4,
      itemsPerKindPerDifficulty: 1,
    });

    expect(fixture.categories).toHaveLength(3);
    expect(fixture.subsubcategories).toHaveLength(12);
  });
});
