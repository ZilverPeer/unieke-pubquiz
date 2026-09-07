/**
 * Daily pruning job (spec #36, ticket #42): deletes the Storage objects of
 * expired download tokens and marks those Quizzes pruned (the token itself
 * is kept -- see markPruned's doc comment and CONTEXT.md "Orders and
 * Quizzes" -- so the download route can still recognise it and answer 410),
 * and also deletes any leftover (possibly partial) objects of `failed`
 * Quizzes -- see README.md "Known limitations". Scheduled at 03:00 via
 * pg-boss's `boss.schedule` on the `deliverables-prune` queue, wired up in
 * index.ts.
 */
import type { PgBoss } from "pg-boss";
import { DELIVERABLE_FILES, DOWNLOAD_VALIDITY_DAYS } from "@/domain";
import type { OrderRepository, RemoveDeliverables } from "@/repository";

export const PRUNE_QUEUE = "deliverables-prune";

/** Daily at 03:00 -- see index.ts's schedulePruneJob. */
export const PRUNE_SCHEDULE_CRON = "0 3 * * *";

export interface PruneDeps {
  orderRepository: OrderRepository;
  removeDeliverables: RemoveDeliverables;
}

export interface PruneResult {
  /** Quiz ids whose expired objects were deleted and marked pruned this run. */
  prunedQuizIds: string[];
  /** Failed Quiz ids whose leftover objects were cleaned up this run. */
  cleanedFailedQuizIds: string[];
  /**
   * Quiz ids (from either branch) whose pruning attempt threw and was
   * skipped this run -- logged and left for the next run rather than
   * aborting the rest of the batch.
   */
  failedQuizIds: string[];
}

function objectPaths(quizId: string): string[] {
  return DELIVERABLE_FILES.map((file) => `${quizId}/${file}`);
}

/**
 * Runs one pruning pass. Takes `now` explicitly (rather than reading
 * `Date.now()` itself) so tests can backdate a Quiz's `delivered_at` and
 * exercise the 30-day cutoff without waiting or touching the schedule.
 *
 * One Quiz's failure (a Storage error, a transient DB error, ...) must not
 * stop the rest of the batch from being pruned: each Quiz's work is wrapped
 * individually, logged, and skipped on error so the run continues.
 */
export async function pruneDeliverables(deps: PruneDeps, now: Date): Promise<PruneResult> {
  const cutoff = new Date(now.getTime() - DOWNLOAD_VALIDITY_DAYS * 24 * 60 * 60 * 1000);

  const expired = await deps.orderRepository.listQuizzesDeliveredBefore(cutoff);
  const prunedQuizIds: string[] = [];
  const failedQuizIds: string[] = [];
  for (const quiz of expired) {
    try {
      await deps.removeDeliverables(objectPaths(quiz.id));
      await deps.orderRepository.markPruned(quiz.id, now);
      prunedQuizIds.push(quiz.id);
    } catch (error) {
      console.error(`[worker] prune failed for Quiz ${quiz.id}`, error);
      failedQuizIds.push(quiz.id);
    }
  }

  const failed = await deps.orderRepository.listFailedQuizzes();
  const cleanedFailedQuizIds: string[] = [];
  for (const quiz of failed) {
    try {
      await deps.removeDeliverables(objectPaths(quiz.id));
      cleanedFailedQuizIds.push(quiz.id);
    } catch (error) {
      console.error(`[worker] prune failed for Quiz ${quiz.id}`, error);
      failedQuizIds.push(quiz.id);
    }
  }

  return { prunedQuizIds, cleanedFailedQuizIds, failedQuizIds };
}

/** Registers the `deliverables-prune` queue and its daily 03:00 schedule. Call once at worker startup. */
export async function schedulePruneJob(boss: PgBoss): Promise<void> {
  await boss.createQueue(PRUNE_QUEUE);
  await boss.schedule(PRUNE_QUEUE, PRUNE_SCHEDULE_CRON);
}
