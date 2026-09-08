/**
 * The quiz-generation job handler (spec #36, ticket #40): moves one Quiz
 * from `pending` through `generating` to `delivered` or `failed`. Runs the
 * existing engine (generate-quiz.ts) unchanged, zips its four rendered files
 * into one Deliverable (ticket #73, src/render/quiz-zip.ts), uploads it,
 * records the download token, and calls the pinned deliver interface. See
 * README.md for the full state machine and retry policy.
 *
 * Imports from domain, repository, scripts/generate-quiz, render's
 * buildQuizZip and deliver's interface only -- this is the one module
 * allowed to cross those boundaries (CLAUDE.md "Orthogonal pipeline"). No
 * WooCommerce knowledge.
 */
import { randomBytes } from "node:crypto";
import { DELIVERABLE_CONTENT_TYPES, downloadPath, orderWideQuizSequence, SLOT_COUNT } from "@/domain";
import type { Deliverer } from "@/deliver";
import type { ContentRepository, OrderRepository, UploadDeliverable } from "@/repository";
import { QuizStatusChangedConcurrentlyError } from "@/repository";
import type { QuizRecord } from "@/domain";
import { buildQuizZip } from "@/render";
import { generateQuiz as generateQuizImpl, type GeneratedQuizFiles } from "@/scripts/generate-quiz";
import type { GenerateOptions } from "@/scripts/cli-args";
import { buildFailureReason, type FailureReasonInput } from "./failure-reason";

/** Thrown for a Quiz whose checkout configuration cannot be satisfied at all -- never retried. */
export class InvalidQuizConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidQuizConfigError";
  }
}

/** Wraps generateQuiz's shortfall result as an error so the handler's terminal-path handling covers both. */
export class QuizShortfallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuizShortfallError";
  }
}

/** Data carried on the pg-boss job: just enough to look everything else up via the repository. */
export interface QuizJobData {
  quizId: string;
}

/**
 * The subset of a pg-boss `JobWithMetadata` the handler needs. A plain
 * interface (not `pg-boss`'s own type) so tests can drive the handler
 * directly without a running queue -- see quiz-job.integration.test.ts.
 */
export interface QuizJobLike {
  data: QuizJobData;
  retryCount: number;
  retryLimit: number;
}

export interface QuizJobDeps {
  orderRepository: OrderRepository;
  contentRepository: ContentRepository;
  uploadDeliverable: UploadDeliverable;
  deliverer: Deliverer;
  /**
   * The engine entry point (src/scripts/generate-quiz.ts), injected the same
   * way `deliverer` is: always provided explicitly by the caller, never
   * defaulted inside this module. `src/worker/index.ts` wires in the real
   * `generateQuiz`; `quiz-job.integration.test.ts`'s retry-policy suite
   * injects a stub that skips actual rendering, since those tests are about
   * deliverQuiz's retry behaviour, not the renderer (ticket #43 fix round --
   * the real renderer, 3 PDFs plus an ffmpeg-driven MP3, is the single most
   * expensive thing this handler does, and previously ran for real even in
   * tests whose point was "no regeneration on retries").
   */
  generateQuiz: typeof generateQuizImpl;
  /** Base URL the download route is served from, e.g. `http://localhost:3000`. No trailing slash. */
  appBaseUrl: string;
}

function generateDownloadToken(): string {
  // 32 random bytes, base64url-encoded: URL-safe (no `/? +`) and long enough
  // that a download link cannot be guessed (CONTEXT.md "download links go
  // through our app... a link cannot be guessed").
  return randomBytes(32).toString("base64url");
}

function buildDownloadUrl(appBaseUrl: string, token: string): string {
  return `${appBaseUrl}${downloadPath(token, "quiz.zip")}`;
}

/**
 * The Quiz's 1-based position among every Quiz belonging to its order --
 * the same number `quizZipFilename`'s `sequence` argument is built from
 * (`orderWideQuizSequence(...) + 1`, src/domain/orders.ts). Needed only for
 * the plain-words failure text (buildFailureReason's `quizNumber`), so it's
 * computed lazily, right before a failure text is built, rather than on
 * every job.
 */
async function computeQuizNumber(deps: QuizJobDeps, quiz: QuizRecord): Promise<number> {
  const orderedQuizzes = await deps.orderRepository.listQuizzesByOrderId(quiz.orderId);
  return orderWideQuizSequence(quiz.id, orderedQuizzes.map((q) => q.id)) + 1;
}

function baseFailureReasonInput(quiz: QuizRecord, billingEmail: string, quizNumber: number) {
  return {
    quizId: quiz.id,
    quizNumber,
    billingEmail,
    locale: quiz.config.locale,
    requestedDifficulty: quiz.config.requestedDifficulty,
  };
}

/**
 * Builds the engine's request from a Quiz's stored config. Throws
 * InvalidQuizConfigError for a combination the sampler could never satisfy
 * regardless of pool contents (mirrors resolveSlotCategories's own
 * distinct/at-most-8 checks, src/sample/index.ts, as defense in depth: a
 * stored Quiz row should never actually fail this, but if one somehow does,
 * this must fail terminally rather than let the sampler's own throw get
 * treated as retryable) -- a malformed or incomplete checkout configuration
 * is a terminal failure (spec #36 user story 27), not a retryable one.
 */
function buildGenerateOptions(
  quiz: QuizRecord,
  billingEmail: string,
  quizNumber: number,
): GenerateOptions {
  const { config } = quiz;
  const { categoryPicks } = config;

  if (categoryPicks.length > SLOT_COUNT) {
    throw new InvalidQuizConfigError(
      buildFailureReason({
        ...baseFailureReasonInput(quiz, billingEmail, quizNumber),
        kind: "invalid-config",
        detail: `This Quiz was configured with ${categoryPicks.length} Category picks, more than the maximum of ${SLOT_COUNT}.`,
      }),
    );
  }
  if (new Set(categoryPicks).size !== categoryPicks.length) {
    throw new InvalidQuizConfigError(
      buildFailureReason({
        ...baseFailureReasonInput(quiz, billingEmail, quizNumber),
        kind: "invalid-config",
        detail: "This Quiz was configured with duplicate Category picks; each pick must be a distinct Category.",
      }),
    );
  }

  return {
    locale: config.locale,
    categoryPicks: config.categoryPicks,
    requestedDifficulty: config.requestedDifficulty,
    billingEmail,
    // Random per attempt: a retry after a transient failure should not be
    // forced to reproduce the exact same sample.
    seed: randomBytes(4).readUInt32BE(0),
    // The worker never writes to disk; generateQuiz only reads `out` from
    // GenerateOptions to build the CLI's default value, and never touches it
    // itself (see generate-quiz.ts).
    out: "unused",
  };
}

/**
 * Marks a Quiz `failed` and notifies the deliverer. `transitionQuizStatus`
 * re-reads the Quiz's current status itself and validates the edge, so this
 * needs no special-casing for *which* status the Quiz is coming from --
 * both `pending -> failed` and `generating -> failed` are legal
 * (QUIZ_STATUS_TRANSITIONS) -- only for a lost compare-and-swap race: if
 * another writer changed the status between our read and this write
 * (`QuizStatusChangedConcurrentlyError`), re-read before deciding what to
 * do rather than assume the race means anything in particular.
 */
async function failQuiz(deps: QuizJobDeps, quizId: string, reason: string): Promise<void> {
  try {
    await deps.orderRepository.transitionQuizStatus(quizId, "failed", { failureReason: reason });
  } catch (error) {
    if (!(error instanceof QuizStatusChangedConcurrentlyError)) {
      throw error;
    }

    const current = await deps.orderRepository.getQuizById(quizId);
    if (current?.status === "failed" || current?.status === "delivered") {
      // Another writer already moved it somewhere terminal -- nothing left
      // for this attempt to do (a concurrent `failed` already ran
      // noteFailure of its own; a concurrent `delivered` means generation
      // won the race after all).
      return;
    }
    // Still live (pending/generating): the race is worth one retry.
    await deps.orderRepository.transitionQuizStatus(quizId, "failed", { failureReason: reason });
  }

  await deps.deliverer.noteFailure({ quizId, reason });
}

/**
 * Runs the engine, zips its four rendered files into one Deliverable
 * (ticket #73, buildQuizZip), and uploads it, without touching Quiz status
 * -- the caller (handleQuizJob) decides what a thrown error here means for
 * the Quiz's status. Returns the download URL deliverQuiz needs once
 * generation and recording have both succeeded.
 */
async function generateAndRecord(
  deps: QuizJobDeps,
  quiz: QuizRecord,
  billingEmail: string,
): Promise<{ url: string }> {
  const quizNumber = await computeQuizNumber(deps, quiz);
  const generateOptions = buildGenerateOptions(quiz, billingEmail, quizNumber);

  const writeDeliverables = async (files: GeneratedQuizFiles): Promise<void> => {
    const zip = buildQuizZip(files);
    await deps.uploadDeliverable(`${quiz.id}/quiz.zip`, zip, DELIVERABLE_CONTENT_TYPES["quiz.zip"]);
  };

  const result = await deps.generateQuiz(generateOptions, deps.contentRepository, writeDeliverables);

  if (!result.ok) {
    const { failure, categoryLabel } = result;
    const base = baseFailureReasonInput(quiz, billingEmail, quizNumber);
    const failureInput: FailureReasonInput =
      failure.categoryId === null
        ? { ...base, kind: "no-category-left", missingSlotCount: failure.shortfall }
        : { ...base, kind: "shortfall", slotIndex: failure.slotIndex, categoryLabel, missingCount: failure.shortfall };
    throw new QuizShortfallError(buildFailureReason(failureInput));
  }

  const token = generateDownloadToken();
  await deps.orderRepository.recordDelivery(quiz.id, {
    compositionId: result.compositionId,
    downloadToken: token,
  });

  return { url: buildDownloadUrl(deps.appBaseUrl, token) };
}

function urlFromDelivered(appBaseUrl: string, token: string): string {
  return buildDownloadUrl(appBaseUrl, token);
}

/**
 * The job handler. Never throws for a terminal failure (shortfall, invalid
 * config): it completes the job after recording `failed` and calling
 * `noteFailure`, so pg-boss never retries it. Any other error before
 * delivery -- including a lookup coming back empty, a lost compare-and-swap
 * race, or an illegal transition (e.g. a stale `generating` Quiz whose prior
 * attempt crashed instead of throwing) -- is treated as retryable: rethrown
 * so pg-boss retries it (up to the queue's retryLimit), unless this is
 * already the final attempt. On the final attempt *every* such error --
 * including the ones above that don't come from generation itself -- still
 * marks the Quiz `failed` and calls `noteFailure` instead of propagating,
 * so pg-boss never dead-letters the job leaving the Quiz stuck.
 *
 * A retry can land here with the Quiz already `delivered`, if a prior
 * attempt generated and recorded delivery successfully but `deliverQuiz`
 * itself then threw: `delivered` has no outgoing edge
 * (QUIZ_STATUS_TRANSITIONS), so generation is never repeated in that case --
 * this re-derives the same file URLs from the already-recorded token and
 * retries only `deliverQuiz` (idempotent by contract, see
 * src/deliver/index.ts). On the final attempt it only logs instead of
 * rethrowing -- see README.md "If deliverQuiz keeps failing".
 */
export async function handleQuizJob(job: QuizJobLike, deps: QuizJobDeps): Promise<void> {
  const { quizId } = job.data;
  const isLastAttempt = job.retryCount >= job.retryLimit;

  let url: string;
  // Only true once this attempt has itself moved the Quiz to "generating" --
  // guards the retry path below from attempting a transition that either
  // never applies (nothing was transitioned yet) or is no longer legal.
  let transitionedToGenerating = false;

  try {
    const current = await deps.orderRepository.getQuizById(quizId);
    if (!current) {
      throw new Error(`Quiz ${quizId} not found`);
    }

    if (current.status === "delivered") {
      if (!current.downloadToken) {
        throw new Error(`Quiz ${quizId} is "delivered" without a download token`);
      }
      url = urlFromDelivered(deps.appBaseUrl, current.downloadToken);
    } else {
      const quiz = await deps.orderRepository.transitionQuizStatus(quizId, "generating");
      transitionedToGenerating = true;

      const order = await deps.orderRepository.getOrderById(quiz.orderId);
      if (!order) {
        throw new Error(`Quiz ${quizId} references missing order ${quiz.orderId}`);
      }

      url = (await generateAndRecord(deps, quiz, order.billingEmail)).url;
    }
  } catch (error) {
    if (error instanceof InvalidQuizConfigError || error instanceof QuizShortfallError) {
      await failQuiz(deps, quizId, error.message);
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    if (isLastAttempt) {
      await failQuiz(deps, quizId, message);
      return;
    }

    if (transitionedToGenerating) {
      // This attempt itself moved the Quiz to "generating"; undo that so
      // the next attempt starts from "pending" again. A failure that
      // happened before any transition (Quiz not found, the transition
      // itself losing a race) leaves nothing to undo -- the next attempt's
      // own fresh lookup picks the right path regardless.
      await deps.orderRepository.transitionQuizStatus(quizId, "pending");
    }
    throw error;
  }

  try {
    await deps.deliverer.deliverQuiz({ quizId, url });
  } catch (error) {
    if (isLastAttempt) {
      console.error(
        `[worker] deliverQuiz failed on the final attempt for Quiz ${quizId}; Quiz stays "delivered" (see ticket #43).`,
        error,
      );
      return;
    }
    throw error;
  }
}
