/**
 * Composition root for the worker (spec #36, ticket #40): wires the
 * repository, deliver module and pg-boss together. This is what
 * src/instrumentation.ts calls when `PUBQUIZ_WORKER=1`. See README.md.
 */
import type { PgBoss } from "pg-boss";
import { createDeliverer } from "@/deliver";
import {
  createDeliverableRemover,
  createDeliverableUploader,
  createOrderRepository,
  createRepository,
  resolveLocalStackConfig,
} from "@/repository";
import { QUIZ_QUEUE, startBoss, stopBoss } from "./boss";
import { PRUNE_QUEUE, pruneDeliverables, schedulePruneJob } from "./prune";
import { handleQuizJob, type QuizJobData, type QuizJobDeps } from "./quiz-job";
import { sweepPendingQuizzes } from "./sweep";

const DEFAULT_APP_BASE_URL = "http://localhost:3000";

function resolveAppBaseUrl(): string {
  return process.env.APP_BASE_URL ?? DEFAULT_APP_BASE_URL;
}

export interface Worker {
  boss: PgBoss;
  stop(): Promise<void>;
}

/**
 * Starts the worker: creates a pg-boss instance against `DATABASE_URL` (see
 * boss.ts), registers the job handler, sweeps `pending` Quizzes without a
 * live job, and returns a handle to stop it.
 *
 * `createDeliverer()` (ticket #41, not yet implemented -- currently always
 * throws) is called lazily, once per job about to run, rather than here at
 * startup: nothing about a Quiz has been touched yet at that point, so a
 * thrown error there is a plain retryable failure pg-boss handles on its
 * own, and startup itself never depends on the deliver module being ready.
 */
export async function startWorker(): Promise<Worker> {
  const config = resolveLocalStackConfig();
  const orderRepository = createOrderRepository(config);
  const contentRepository = createRepository(config);
  const uploadDeliverable = createDeliverableUploader(config);
  const removeDeliverables = createDeliverableRemover(config);
  const appBaseUrl = resolveAppBaseUrl();

  const boss = await startBoss();

  await boss.work<QuizJobData, void, { includeMetadata: true }>(QUIZ_QUEUE, { includeMetadata: true }, async (jobs) => {
    // batchSize defaults to 1: one job per handler invocation.
    const [job] = jobs;
    const deps: QuizJobDeps = {
      orderRepository,
      contentRepository,
      uploadDeliverable,
      deliverer: createDeliverer(),
      appBaseUrl,
    };
    await handleQuizJob(job, deps);
  });

  // Daily pruning job (ticket #42): its own queue/schedule, registered
  // alongside the quiz-generation one. See prune.ts.
  await schedulePruneJob(boss);
  await boss.work(PRUNE_QUEUE, async () => {
    const result = await pruneDeliverables({ orderRepository, removeDeliverables }, new Date());
    console.log(
      `[worker] pruned ${result.prunedQuizIds.length} expired Quiz(zes), cleaned up ${result.cleanedFailedQuizIds.length} failed Quiz(zes)`,
    );
  });

  const enqueued = await sweepPendingQuizzes(boss, orderRepository);
  console.log(`[worker] started (queue "${QUIZ_QUEUE}"); swept ${enqueued} pending Quiz job(s)`);

  return {
    boss,
    stop: () => stopBoss(boss),
  };
}

export { QUIZ_QUEUE, startBoss, stopBoss } from "./boss";
export { PRUNE_QUEUE, pruneDeliverables, schedulePruneJob } from "./prune";
export { handleQuizJob, type QuizJobData, type QuizJobDeps, type QuizJobLike } from "./quiz-job";
export { sweepPendingQuizzes } from "./sweep";
