/**
 * `--retry-quiz <id>` (ticket #42): moves a `failed` Quiz back to `pending`
 * and re-enqueues its generation job. Pure with respect to pg-boss -- takes
 * an injected `enqueue` function so tests never need a running queue, and
 * the real CLI entry point (generate.ts) supplies one backed by pg-boss's
 * `boss.send` with the Quiz id as `singletonKey`, exactly like the worker's
 * own sweep (src/worker/sweep.ts).
 */
import type { OrderRepository } from "@/repository";

export interface RetryQuizDeps {
  orderRepository: OrderRepository;
  /** Enqueues the Quiz's generation job; returns the job id, or null if one was already queued (singletonKey). */
  enqueue(quizId: string): Promise<string | null>;
}

export interface RetryQuizResult {
  exitCode: 0 | 1;
  message: string;
}

/**
 * Refuses (exit code 1) a Quiz that doesn't exist or isn't currently
 * `failed` -- retrying is only meaningful for a Quiz that actually failed;
 * anything else (pending/generating/delivered) is left alone.
 */
export async function retryQuiz(quizId: string, deps: RetryQuizDeps): Promise<RetryQuizResult> {
  const quiz = await deps.orderRepository.getQuizById(quizId);
  if (!quiz) {
    return { exitCode: 1, message: `Quiz ${quizId} not found` };
  }

  if (quiz.status !== "failed") {
    return {
      exitCode: 1,
      message: `Quiz ${quizId} is "${quiz.status}", not "failed" -- refusing to retry`,
    };
  }

  await deps.orderRepository.transitionQuizStatus(quizId, "pending");
  await deps.enqueue(quizId);

  return { exitCode: 0, message: `Quiz ${quizId} moved back to "pending" and re-enqueued` };
}
