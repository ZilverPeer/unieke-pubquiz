/**
 * The WooCommerce line item meta_data keys that carry a Quiz's configuration
 * (spec #36). The shop setup script (#37) creates add-on fields with exactly
 * these keys; the webhook parser (#39) reads them. Change both or neither.
 *
 * Values are the domain vocabulary verbatim: Locale "nl" | "en",
 * RequestedDifficulty "easy" | "medium" | "hard" | "mixed", Category picks
 * are Category ids, in pick order.
 */
import type { DeliverableFile } from "./orders";
import { SLOT_COUNT } from "./types";

export const CHECKOUT_META_KEYS = {
  locale: "pubquiz_locale",
  requestedDifficulty: "pubquiz_difficulty",
  /** Category pick at `pickIndex` (0-based, 0 to 7); the key is 1-based for customers. */
  categoryPick: (pickIndex: number): string => {
    if (!Number.isInteger(pickIndex) || pickIndex < 0 || pickIndex >= SLOT_COUNT) {
      throw new RangeError(`pickIndex must be 0..${SLOT_COUNT - 1}, got ${pickIndex}`);
    }
    return `pubquiz_category_${pickIndex + 1}`;
  },
} as const;

/** Prefix of private order notes that the shop's mail plugin forwards to the operator. */
export const OPERATOR_NOTE_PREFIX = "[pubquiz]";

/**
 * The line item meta_data key the deliver module (#41) writes a Deliverable's
 * download URL under. A line item's quantity can be above one -- several
 * Quizzes then share one wooLineItemId (src/repository/orders.ts,
 * CONTEXT.md "Order"/"Quiz") -- so the key carries the Quiz's `sequence`
 * (0-based internally, 1-based here for customers, same convention as
 * `CHECKOUT_META_KEYS.categoryPick`) to keep each Quiz's four files distinct
 * instead of the last-delivered Quiz's links clobbering the others'.
 * `shop/mu-plugins/pubquiz-downloads.php` reads this same key stem to find,
 * group, and render the download links; a fixture test
 * (shop-fixture.test.ts) checks the PHP literal stays in sync by hand (PHP
 * cannot import this constant).
 */
export function downloadMetaKey(sequence: number, file: DeliverableFile): string {
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new RangeError(`sequence must be a non-negative integer, got ${sequence}`);
  }
  return `pubquiz_download_${sequence + 1}_${file}`;
}
