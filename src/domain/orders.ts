/**
 * Order and Quiz records as the pipeline sees them (spec #36). Vocabulary
 * matches CONTEXT.md. This module imports nothing from other src modules.
 *
 * Pinned on master before the spec 2 wave so that the repository (#38), the
 * webhook (#39), the worker (#40) and the deliver module (#41) share one shape.
 */
import type { CategoryPick, Locale, QuizMode, RequestedDifficulty } from "./types";

/** Lifecycle of one Quiz line item. Legal edges are enforced by the repository. */
export type QuizStatus = "pending" | "generating" | "delivered" | "failed";

export const QUIZ_STATUS_TRANSITIONS: Readonly<Record<QuizStatus, readonly QuizStatus[]>> = {
  pending: ["generating", "failed"],
  generating: ["delivered", "failed", "pending"],
  delivered: [],
  failed: ["pending"],
};

/** The per-Quiz configuration captured at checkout (line item meta_data). */
export interface QuizConfig {
  locale: Locale;
  quizMode: QuizMode;
  /** Category id per slot (index 0-7), undefined where the slot is unassigned. */
  categoryPicks: CategoryPick[];
  requestedDifficulty: RequestedDifficulty;
}

/** One WooCommerce order as recorded by the webhook. */
export interface OrderRecord {
  id: string;
  wooOrderId: number;
  /** Trimmed and lower-cased, see CONTEXT.md "No-repeat rule". */
  billingEmail: string;
  wooStatus: string;
  createdAt: string;
}

/** One Quiz to generate: a line item unit (quantity n yields n Quizzes). */
export interface QuizRecord {
  id: string;
  orderId: string;
  wooLineItemId: number;
  /** 0-based index within the line item's quantity. */
  sequence: number;
  config: QuizConfig;
  status: QuizStatus;
  failureReason: string | null;
  compositionId: string | null;
  downloadToken: string | null;
  deliveredAt: string | null;
  /**
   * Set by the daily pruning job (ticket #42, src/worker/prune.ts) when this
   * Quiz's Deliverable objects were deleted from Storage; the token itself
   * is kept (see "Orders and Quizzes" in CONTEXT.md) so the download route
   * still recognises it and answers 410 rather than 404. Cleared by
   * `--composition` re-rendering (src/scripts/recompose-quiz.ts).
   */
  prunedAt: string | null;
}

/** The four Deliverables of a Quiz, by fixed file name. */
/**
 * The single Deliverable stored/served per Quiz (ticket #73): a zip
 * containing the four rendered files (see src/render/quiz-zip.ts's
 * buildQuizZip, which keeps their own names -- quizmaster.pdf,
 * picture-handout.pdf, answer-sheet.pdf, music-round.mp3 -- unchanged
 * inside the archive). A tuple of one, not a bare string constant, so every
 * caller that already iterates DELIVERABLE_FILES (the worker's upload, the
 * pruning job's object-path list, the download route's file-name check)
 * keeps working unchanged.
 */
export const DELIVERABLE_FILES = ["quiz.zip"] as const;

export type DeliverableFile = (typeof DELIVERABLE_FILES)[number];

/** Path of the app download route for a Quiz's Deliverable (ticket #42 serves it). */
export function downloadPath(token: string, file: DeliverableFile): string {
  return `/download/${token}/${file}`;
}

/**
 * Days a download token stays valid after `delivered_at` (CONTEXT.md
 * "Orders and Quizzes"). The daily pruning job (ticket #42, src/worker/prune.ts)
 * clears any token/objects older than this; the shop's own product download
 * expiry (ticket #37) is set to match this constant, not re-derived.
 */
export const DOWNLOAD_VALIDITY_DAYS = 30;

/**
 * Content-Type per Deliverable file. Shared by the worker's upload
 * (src/worker/quiz-job.ts) and the download route (ticket #42) so the two
 * never drift apart.
 */
export const DELIVERABLE_CONTENT_TYPES: Record<DeliverableFile, string> = {
  "quiz.zip": "application/zip",
};

/**
 * The one place that builds a Quiz's zip file name (ticket #73):
 * `pubquiz-<WooCommerce order number>-<quiz sequence, 1-based>-<locale>.zip`.
 * `orderNumber` is the Quiz's order's `wooOrderId`; `sequence` is 0-based
 * internally (same convention as `CHECKOUT_META_KEYS.categoryPick` and
 * `downloadMetaKey`), 1-based in the name. The download route
 * (src/app/download) sends this as the `Content-Disposition` filename; the
 * shop's `pubquiz-downloads.php` mu-plugin builds the identical string in
 * PHP (it cannot import this function) -- `src/domain/shop-fixture.test.ts`
 * pins the pattern literal so the two can't silently drift apart.
 */
export function quizZipFilename(orderNumber: number, sequence: number, locale: Locale): string {
  return `pubquiz-${orderNumber}-${sequence + 1}-${locale}.zip`;
}
