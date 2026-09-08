/**
 * The WooCommerce line item meta_data keys that carry a Quiz's configuration
 * (spec #36). The shop setup script (#37) creates add-on fields with exactly
 * these keys; the webhook parser (#39) reads them. Change both or neither.
 *
 * Values are the domain vocabulary verbatim: Locale "nl" | "en",
 * RequestedDifficulty "easy" | "medium" | "hard" | "mixed",
 * QuizMode "mixed" | "single_category", Category picks are Category ids.
 */
import { SLOT_COUNT } from "./types";

export const CHECKOUT_META_KEYS = {
  locale: "pubquiz_locale",
  requestedDifficulty: "pubquiz_difficulty",
  quizMode: "pubquiz_mode",
  /** Category pick for slot `slotIndex` (0-7); the key is 1-based for customers. */
  categoryPick: (slotIndex: number): string => {
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= SLOT_COUNT) {
      throw new RangeError(`slotIndex must be 0..${SLOT_COUNT - 1}, got ${slotIndex}`);
    }
    return `pubquiz_category_${slotIndex + 1}`;
  },
} as const;

/** Prefix of private order notes that the shop's mail plugin forwards to the operator. */
export const OPERATOR_NOTE_PREFIX = "[pubquiz]";

/**
 * The line item meta_data key the deliver module (#41) writes a Quiz's zip
 * download URL under (ticket #73: one key per Quiz, not one per file -- a
 * Quiz is now a single Deliverable, see DELIVERABLE_FILES/quizZipFilename
 * in src/domain/orders.ts). A line item's quantity can be above one --
 * several Quizzes then share one wooLineItemId (src/repository/orders.ts,
 * CONTEXT.md "Order"/"Quiz") -- so the key carries the Quiz's `sequence`
 * (0-based internally, 1-based here for customers, same convention as
 * `CHECKOUT_META_KEYS.categoryPick`) to keep each Quiz's link distinct
 * instead of the last-delivered Quiz's link clobbering the others'.
 * `shop/mu-plugins/pubquiz-downloads.php` reads this same key stem to find
 * and render the download links; a fixture test (shop-fixture.test.ts)
 * checks the PHP literal stays in sync by hand (PHP cannot import this
 * constant).
 */
export function downloadMetaKey(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new RangeError(`sequence must be a non-negative integer, got ${sequence}`);
  }
  return `pubquiz_download_${sequence + 1}`;
}
