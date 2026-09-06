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
}

/** The four Deliverables of a Quiz, by fixed file name. */
export const DELIVERABLE_FILES = [
  "quizmaster.pdf",
  "picture-handout.pdf",
  "answer-sheet.pdf",
  "music-round.mp3",
] as const;

export type DeliverableFile = (typeof DELIVERABLE_FILES)[number];

/** Path of the app download route for one Deliverable (ticket #42 serves it). */
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
  "quizmaster.pdf": "application/pdf",
  "picture-handout.pdf": "application/pdf",
  "answer-sheet.pdf": "application/pdf",
  "music-round.mp3": "audio/mpeg",
};
