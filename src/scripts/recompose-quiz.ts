/**
 * `--composition <id>` (ticket #42): re-renders an existing Composition's
 * four Deliverables without re-sampling (no new `compositions` row) and
 * re-attaches them to the Quiz that owns it. Mirrors the worker's own
 * upload-then-deliver shape (src/worker/quiz-job.ts) but skips sampling and
 * persisting entirely -- the Composition already exists.
 *
 * `createDeliverer` (src/deliver, implemented in ticket #41) is real now;
 * deps still take a zero-arg `createDeliverer` factory (called lazily, after
 * upload has already succeeded) so the real CLI can close over its
 * `DelivererConfig`/`OrderLookup` (see generate.ts) and tests can inject a
 * fake `Deliverer` directly. The `isDeliverNotImplementedError` catch below
 * is now dead in practice (the real deliverer never throws that message) --
 * left in place as a harmless safety net rather than removed mid-round.
 */
import { DELIVERABLE_CONTENT_TYPES, DELIVERABLE_FILES, downloadPath } from "@/domain";
import type { Deliverer } from "@/deliver";
import type { ContentRepository, OrderRepository, UploadDeliverable } from "@/repository";
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

function isDeliverNotImplementedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("deliver module not implemented yet");
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

  for (const file of DELIVERABLE_FILES) {
    await deps.uploadDeliverable(`${quiz.id}/${file}`, files[file], DELIVERABLE_CONTENT_TYPES[file]);
  }

  // Re-attach: now that the objects exist again, un-prune the Quiz so its
  // existing download link (the token itself was never cleared -- see
  // prune.ts) works again, whether or not this Quiz was pruned at all.
  await deps.orderRepository.clearPruned(quiz.id);

  const deliveredFiles = DELIVERABLE_FILES.map((file) => ({
    file,
    url: `${deps.appBaseUrl}${downloadPath(quiz.downloadToken!, file)}`,
  }));

  try {
    const deliverer = deps.createDeliverer();
    await deliverer.deliverQuiz({ quizId: quiz.id, files: deliveredFiles });
  } catch (error) {
    if (isDeliverNotImplementedError(error)) {
      return {
        exitCode: 0,
        message: `Deliverables re-rendered and uploaded for Quiz ${quiz.id}; delivery is not implemented yet (ticket #41)`,
      };
    }
    throw error;
  }

  return { exitCode: 0, message: `Deliverables re-rendered and delivered for Quiz ${quiz.id}` };
}
