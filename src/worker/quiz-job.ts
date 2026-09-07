/**
 * The quiz-generation job handler (spec #36, ticket #40): moves one Quiz
 * from `pending` through `generating` to `delivered` or `failed`. Runs the
 * existing engine (generate-quiz.ts) unchanged, uploads the four
 * Deliverables, records the download token, and calls the pinned deliver
 * interface. See README.md for the full state machine and retry policy.
 *
 * Imports from domain, repository, scripts/generate-quiz and deliver's
 * interface only -- this is the one module allowed to cross those
 * boundaries (CLAUDE.md "Orthogonal pipeline"). No WooCommerce knowledge.
 */
import { randomBytes } from "node:crypto";
import type { DeliverableFile } from "@/domain";
import { DELIVERABLE_CONTENT_TYPES, DELIVERABLE_FILES, downloadPath } from "@/domain";
import type { Deliverer } from "@/deliver";
import type { ContentRepository, OrderRepository, UploadDeliverable } from "@/repository";
import { QuizStatusChangedConcurrentlyError } from "@/repository";
import type { QuizRecord } from "@/domain";
import { generateQuiz, type GeneratedQuizFiles } from "@/scripts/generate-quiz";
import type { GenerateOptions } from "@/scripts/cli-args";

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
  /** Base URL the download route is served from, e.g. `http://localhost:3000`. No trailing slash. */
  appBaseUrl: string;
}

function generateDownloadToken(): string {
  // 32 random bytes, base64url-encoded: URL-safe (no `/? +`) and long enough
  // that a download link cannot be guessed (CONTEXT.md "download links go
  // through our app... a link cannot be guessed").
  return randomBytes(32).toString("base64url");
}

function buildDownloadUrl(appBaseUrl: string, token: string, file: DeliverableFile): string {
  return `${appBaseUrl}${downloadPath(token, file)}`;
}

/**
 * Builds the engine's request from a Quiz's stored config. Throws
 * InvalidQuizConfigError for a combination the sampler could never satisfy
 * regardless of pool contents (mirrors src/scripts/cli-args.ts's own
 * single_category validation) -- a malformed or incomplete checkout
 * configuration is a terminal failure (spec #36 user story 27), not a
 * retryable one.
 */
function buildGenerateOptions(quiz: QuizRecord, billingEmail: string): GenerateOptions {
  const { config } = quiz;
  const pickCount = config.categoryPicks.filter((pick) => pick !== undefined).length;

  if (config.quizMode === "single_category" && pickCount !== 1) {
    throw new InvalidQuizConfigError(
      `Quiz ${quiz.id}: mode "single_category" requires exactly one Category pick, got ${pickCount}`,
    );
  }

  return {
    locale: config.locale,
    quizMode: config.quizMode,
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

function formatShortfallReason(slotIndex: number, categoryLabel: string, shortfall: number): string {
  return `slot ${slotIndex}, Category ${categoryLabel}, shortfall ${shortfall}`;
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
 * Runs the engine and uploads its output, without touching Quiz status --
 * the caller (handleQuizJob) decides what a thrown error here means for the
 * Quiz's status. Returns the download token and the file list deliverQuiz
 * needs once generation and recording have both succeeded.
 */
async function generateAndRecord(
  deps: QuizJobDeps,
  quiz: QuizRecord,
  billingEmail: string,
): Promise<{ files: readonly { file: DeliverableFile; url: string }[] }> {
  const generateOptions = buildGenerateOptions(quiz, billingEmail);

  const writeDeliverables = async (files: GeneratedQuizFiles): Promise<void> => {
    for (const file of DELIVERABLE_FILES) {
      await deps.uploadDeliverable(`${quiz.id}/${file}`, files[file], DELIVERABLE_CONTENT_TYPES[file]);
    }
  };

  const result = await generateQuiz(generateOptions, deps.contentRepository, writeDeliverables);

  if (!result.ok) {
    const { slotIndex, shortfall } = result.failure;
    throw new QuizShortfallError(formatShortfallReason(slotIndex, result.categoryLabel, shortfall));
  }

  const token = generateDownloadToken();
  await deps.orderRepository.recordDelivery(quiz.id, {
    compositionId: result.compositionId,
    downloadToken: token,
  });

  const files = DELIVERABLE_FILES.map((file) => ({
    file,
    url: buildDownloadUrl(deps.appBaseUrl, token, file),
  }));

  return { files };
}

function filesFromDelivered(appBaseUrl: string, token: string): { file: DeliverableFile; url: string }[] {
  return DELIVERABLE_FILES.map((file) => ({ file, url: buildDownloadUrl(appBaseUrl, token, file) }));
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

  let files: readonly { file: DeliverableFile; url: string }[];
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
      files = filesFromDelivered(deps.appBaseUrl, current.downloadToken);
    } else {
      const quiz = await deps.orderRepository.transitionQuizStatus(quizId, "generating");
      transitionedToGenerating = true;

      const order = await deps.orderRepository.getOrderById(quiz.orderId);
      if (!order) {
        throw new Error(`Quiz ${quizId} references missing order ${quiz.orderId}`);
      }

      files = (await generateAndRecord(deps, quiz, order.billingEmail)).files;
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
    await deps.deliverer.deliverQuiz({ quizId, files });
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
