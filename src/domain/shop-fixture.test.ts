import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { CHECKOUT_META_KEYS, downloadMetaKey, OPERATOR_NOTE_PREFIX } from "./checkout";
import { SLOT_COUNT } from "./types";

/**
 * Drift check for ticket #37's shop assets (shop/fixtures/, shop/mu-plugins/):
 * these files are hand-maintained outside src/ and duplicate CHECKOUT_META_KEYS
 * / OPERATOR_NOTE_PREFIX as PHP/JSON literals (PHP cannot import a TS
 * constant). This test fails loudly if either pinned interface changes
 * without the shop assets being updated to match.
 */

const REPO_ROOT = join(__dirname, "..", "..");

interface MetaDatum {
  key: string;
  value: string;
}

function readFixture(): MetaDatum[] {
  const raw = readFileSync(join(REPO_ROOT, "shop", "fixtures", "order-updated-processing.json"), "utf8");
  const fixture = JSON.parse(raw) as { body: { line_items: Array<{ meta_data: MetaDatum[] }> } };
  return fixture.body.line_items[0].meta_data;
}

describe("shop/fixtures/order-updated-processing.json", () => {
  const allowedKeys = new Set<string>([
    CHECKOUT_META_KEYS.locale,
    CHECKOUT_META_KEYS.requestedDifficulty,
    CHECKOUT_META_KEYS.quizMode,
    ...Array.from({ length: SLOT_COUNT }, (_, slot) => CHECKOUT_META_KEYS.categoryPick(slot)),
    "_wapf_meta",
  ]);

  test("every line item meta_data key is one CHECKOUT_META_KEYS produces, or the plugin's own bookkeeping key", () => {
    const meta = readFixture();
    for (const { key } of meta) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });

  test("the four required keys are all present", () => {
    const keys = readFixture().map((m) => m.key);
    expect(keys).toEqual(
      expect.arrayContaining([CHECKOUT_META_KEYS.locale, CHECKOUT_META_KEYS.requestedDifficulty, CHECKOUT_META_KEYS.quizMode]),
    );
    expect(keys.some((key) => key === CHECKOUT_META_KEYS.categoryPick(0))).toBe(true);
  });
});

describe("shop/mu-plugins/pubquiz-operator-mail.php", () => {
  test("references OPERATOR_NOTE_PREFIX's literal value", () => {
    const php = readFileSync(join(REPO_ROOT, "shop", "mu-plugins", "pubquiz-operator-mail.php"), "utf8");
    expect(php).toContain(OPERATOR_NOTE_PREFIX);
  });
});

describe("shop/mu-plugins/pubquiz-downloads.php", () => {
  test("declares the PUBQUIZ_DOWNLOAD_META_PREFIX literal matching downloadMetaKey's stem", () => {
    const php = readFileSync(join(REPO_ROOT, "shop", "mu-plugins", "pubquiz-downloads.php"), "utf8");
    const stem = downloadMetaKey("quizmaster.pdf").replace("quizmaster.pdf", "");
    expect(php).toContain(`PUBQUIZ_DOWNLOAD_META_PREFIX = '${stem}'`);
  });
});

describe("shop/mu-plugins/wp-cli-scripts/setup-field-group.php", () => {
  test("declares all three fixed CHECKOUT_META_KEYS and the category key stem", () => {
    const php = readFileSync(
      join(REPO_ROOT, "shop", "mu-plugins", "wp-cli-scripts", "setup-field-group.php"),
      "utf8",
    );
    expect(php).toContain(CHECKOUT_META_KEYS.locale);
    expect(php).toContain(CHECKOUT_META_KEYS.requestedDifficulty);
    expect(php).toContain(CHECKOUT_META_KEYS.quizMode);
    expect(php).toContain("pubquiz_category_");
  });
});
