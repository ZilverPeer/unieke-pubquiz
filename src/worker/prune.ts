/**
 * Daily pruning job (spec #36, ticket #42): deletes the Storage objects of
 * expired download tokens, clears those tokens, and also deletes any
 * leftover (possibly partial) objects of `failed` Quizzes -- see README.md
 * "Known limitations". Scheduled at 03:00 via pg-boss's `boss.schedule` on
 * the `deliverables-prune` queue, wired up in index.ts.
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
  /** Quiz ids whose expired token/objects were cleared this run. */
  prunedQuizIds: string[];
  /** Failed Quiz ids whose leftover objects were cleaned up this run. */
  cleanedFailedQuizIds: string[];
}

function objectPaths(quizId: string): string[] {
  return DELIVERABLE_FILES.map((file) => `${quizId}/${file}`);
}

/**
 * Runs one pruning pass. Takes `now` explicitly (rather than reading
 * `Date.now()` itself) so tests can backdate a Quiz's `delivered_at` and
 * exercise the 30-day cutoff without waiting or touching the schedule.
 */
export async function pruneDeliverables(deps: PruneDeps, now: Date): Promise<PruneResult> {
  const cutoff = new Date(now.getTime() - DOWNLOAD_VALIDITY_DAYS * 24 * 60 * 60 * 1000);

  const expired = await deps.orderRepository.listQuizzesDeliveredBefore(cutoff);
  const prunedQuizIds: string[] = [];
  for (const quiz of expired) {
    await deps.removeDeliverables(objectPaths(quiz.id));
    await deps.orderRepository.clearDownloadToken(quiz.id);
    prunedQuizIds.push(quiz.id);
  }

  const failed = await deps.orderRepository.listFailedQuizzes();
  const cleanedFailedQuizIds: string[] = [];
  for (const quiz of failed) {
    await deps.removeDeliverables(objectPaths(quiz.id));
    cleanedFailedQuizIds.push(quiz.id);
  }

  return { prunedQuizIds, cleanedFailedQuizIds };
}

/** Registers the `deliverables-prune` queue and its daily 03:00 schedule. Call once at worker startup. */
export async function schedulePruneJob(boss: PgBoss): Promise<void> {
  await boss.createQueue(PRUNE_QUEUE);
  await boss.schedule(PRUNE_QUEUE, PRUNE_SCHEDULE_CRON);
}
