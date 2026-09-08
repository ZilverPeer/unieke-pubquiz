/**
 * Pure decision function behind the download route (ticket #42, path pinned
 * by downloadPath() in src/domain/orders.ts; extended in ticket #73 for the
 * single-zip Deliverable). Kept out of route.ts so it can be driven directly
 * in tests with fakes for both seams -- the token lookup
 * (OrderRepository.getQuizByDownloadToken plus the order it belongs to) and
 * the bucket read (a DownloadDeliverable from src/repository/storage.ts).
 */
import { DELIVERABLE_CONTENT_TYPES, DELIVERABLE_FILES, quizZipFilename, type DeliverableFile, type Locale } from "@/domain";

/**
 * Just enough about a Quiz (and the order it belongs to) to build the
 * storage path, check pruning, and build the zip's Content-Disposition file
 * name (quizZipFilename, src/domain/orders.ts).
 */
export interface DownloadQuizLookup {
  id: string;
  /** Set once the pruning job has deleted this Quiz's objects -- see markPruned (src/repository/orders.ts). */
  prunedAt: string | null;
  /** The Quiz's order's WooCommerce order id -- the file name's "<order number>". */
  wooOrderId: number;
  /**
   * 0-based position among every Quiz in this Quiz's *order* (every line
   * item, not just the ones sharing this Quiz's line item) -- the file
   * name's "<sequence + 1>". Not `quizzes.sequence` (a Quiz's 0-based
   * position among Quizzes sharing one line item, i.e. one quantity-above-one
   * product line): two different line items in the same order both start
   * their own `quizzes.sequence` at 0, so using it directly here would give
   * two different Quizzes in one order the same zip file name. The route
   * (route.ts) computes this order-wide position from
   * OrderRepository.listQuizzesByOrderId's stable (woo_line_item_id,
   * sequence) ordering, matching the same order the shop plugin
   * (pubquiz_order_zip_numbers, shop/mu-plugins/pubquiz-downloads.php)
   * numbers Quizzes in when it walks the order's line items.
   */
  sequenceInOrder: number;
  locale: Locale;
}

export interface ResolveDownloadDeps {
  getQuizByDownloadToken(token: string): Promise<DownloadQuizLookup | null>;
  /** Throws (any error) when the object is missing from the bucket -- see storage.ts's downloadFromBucket. */
  downloadDeliverable(storagePath: string): Promise<Uint8Array>;
}

export type ResolveDownloadResult =
  | { status: 200; body: Uint8Array; contentType: string; filename: string }
  | { status: 404 }
  | { status: 410 };

function isDeliverableFile(file: string): file is DeliverableFile {
  return (DELIVERABLE_FILES as readonly string[]).includes(file);
}

/**
 * Resolves one download request to a plain result the route can turn into a
 * Response: 404 for a file name outside DELIVERABLE_FILES or an unknown
 * token, 410 once the token is known but its Quiz has been pruned
 * (`prunedAt` set -- the pruning job keeps the token precisely so this
 * branch stays reachable, see CONTEXT.md "Orders and Quizzes") or the
 * object is otherwise missing from the bucket, 200 with the zip's bytes and
 * its `pubquiz-<order number>-<sequence + 1>-<locale>.zip` file name
 * otherwise.
 */
export async function resolveDownload(
  token: string,
  file: string,
  deps: ResolveDownloadDeps,
): Promise<ResolveDownloadResult> {
  if (!isDeliverableFile(file)) {
    return { status: 404 };
  }

  const quiz = await deps.getQuizByDownloadToken(token);
  if (!quiz) {
    return { status: 404 };
  }

  if (quiz.prunedAt) {
    return { status: 410 };
  }

  let body: Uint8Array;
  try {
    body = await deps.downloadDeliverable(`${quiz.id}/${file}`);
  } catch {
    return { status: 410 };
  }

  return {
    status: 200,
    body,
    contentType: DELIVERABLE_CONTENT_TYPES[file],
    filename: quizZipFilename(quiz.wooOrderId, quiz.sequenceInOrder, quiz.locale),
  };
}
