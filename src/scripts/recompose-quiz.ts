/**
 * `--composition <id>` (ticket #42): re-renders an existing Composition's
 * four files, zips them into one Deliverable (ticket #73, buildQuizZip)
 * without re-sampling (no new `compositions` row), and re-attaches the zip
 * to the Quiz that owns it. Mirrors the worker's own upload-then-deliver
 * shape (src/worker/quiz-job.ts) but skips sampling and persisting entirely
 * -- the Composition already exists.
 *
 * `createDeliverer` (src/deliver, implemented in ticket #41) is real now;
 * deps still take a zero-arg `createDeliverer` factory (called lazily, after
 * upload has already succeeded) so the real CLI can close over its
 * `DelivererConfig`/`OrderLookup` (see generate.ts) and tests can inject a
 * fake `Deliverer` directly. `isDeliverUnavailableError` below catches two
 * cases as one "upload succeeded, delivery didn't run" outcome rather than
 * crashing the CLI: `resolveDelivererConfigFromEnv()` throwing because
 * `WOOCOMMERCE_*` isn't configured on this machine (the common case --
 * `--composition` is useful for re-rendering even without a shop to deliver
 * to), and the pre-#41 "deliver module not implemented yet" message, kept
 * as a harmless safety net.
 */
import { DELIVERABLE_CONTENT_TYPES, downloadPath } from "@/domain";
import type { Deliverer } from "@/deliver";
import type { ContentRepository, OrderRepository, UploadDeliverable } from "@/repository";
import { buildQuizZip } from "@/render";
import { assembleQuizContent } from "./assemble-quiz-content";
import { renderQuizFiles } from "./generate-quiz";

export interface RecomposeQuizDeps {
  contentRepository: ContentRepository;
  orderRepository: OrderRepository;
  uploadDeliverable: UploadDeliverable;
  /** Called lazily, only once upload has already succeeded -- see createDeliverer()'s ticket #41 note above. */
  createDeliverer(): Deliverer;
  /** Base URL the download route is served from, e.g. `http://localhost:3000`. No trailing slash. */
  appBaseUrl: string;
}

export interface RecomposeQuizResult {
  exitCode: 0 | 1;
  message: string;
}

function isDeliverUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("deliver module not implemented yet") ||
    error.message.includes("deliver: missing environment variable(s)")
  );
}

/**
 * Refuses (exit code 1) a Composition that doesn't exist or has no owning
 * Quiz. A pruned Quiz's download token is *not* a refusal case: pruning
 * (src/worker/prune.ts) keeps the token, so this always has a valid
 * download URL to hand the deliverer -- re-rendering re-uploads the
 * Deliverables and clears the Quiz's pruned state, re-enabling the same
 * link (CONTEXT.md "Orders and Quizzes").
 */
export async function recomposeQuiz(compositionId: string, deps: RecomposeQuizDeps): Promise<RecomposeQuizResult> {
  const compositionRecord = await deps.contentRepository.getCompositionById(compositionId);
  if (!compositionRecord) {
    return { exitCode: 1, message: `Composition ${compositionId} not found` };
  }

  const quiz = await deps.orderRepository.getQuizByCompositionId(compositionId);
  if (!quiz) {
    return { exitCode: 1, message: `Composition ${compositionId} has no Quiz -- refusing to re-render` };
  }

  const pool = await deps.contentRepository.loadPool(compositionRecord.locale);
  const entriesById = new Map(pool.map((entry) => [entry.item.id, entry]));
  const quizContent = await assembleQuizContent(
    compositionRecord.composition,
    compositionRecord.locale,
    entriesById,
    {
      picture: (storagePath) => deps.contentRepository.downloadPicture(storagePath),
      music: (storagePath) => deps.contentRepository.downloadMusicClip(storagePath),
    },
  );

  const files = await renderQuizFiles(quizContent);
  const zip = buildQuizZip(files);
  await deps.uploadDeliverable(`${quiz.id}/quiz.zip`, zip, DELIVERABLE_CONTENT_TYPES["quiz.zip"]);

  // Re-attach: now that the object exists again, un-prune the Quiz so its
  // existing download link (the token itself was never cleared -- see
  // prune.ts) works again, whether or not this Quiz was pruned at all.
  await deps.orderRepository.clearPruned(quiz.id);

  const url = `${deps.appBaseUrl}${downloadPath(quiz.downloadToken!, "quiz.zip")}`;

  try {
    const deliverer = deps.createDeliverer();
    await deliverer.deliverQuiz({ quizId: quiz.id, url });
  } catch (error) {
    if (isDeliverUnavailableError(error)) {
      return {
        exitCode: 0,
        message: `Deliverables re-rendered and uploaded for Quiz ${quiz.id}; delivery skipped (deliver module not configured: ${(error as Error).message})`,
      };
    }
    throw error;
  }

  return { exitCode: 0, message: `Deliverables re-rendered and delivered for Quiz ${quiz.id}` };
}
