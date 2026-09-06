/**
 * Startup sweep (spec #36, ticket #40): enqueues a job for every `pending`
 * Quiz that doesn't already have one. Needed because inserting a Quiz row
 * (the webhook, #39) and enqueueing its job are not one transaction (the
 * webhook uses supabase-js, pg-boss uses its own `pg` connection -- see
 * issue #36's "Design change from the spec"), so a Quiz can land as
 * `pending` with no job if the worker was down, crashed between insert and
 * enqueue, or a `send()` was lost. The queue's `exclusive` policy with the
 * Quiz id as `singletonKey` (see boss.ts) makes calling this safe even when
 * a job already exists: `send()` returns `null` instead of creating a
 * second one.
 */
import type { PgBoss } from "pg-boss";
import type { OrderRepository } from "@/repository";
import { QUIZ_QUEUE } from "./boss";
import type { QuizJobData } from "./quiz-job";

export async function sweepPendingQuizzes(boss: PgBoss, orderRepository: OrderRepository): Promise<number> {
  const pending = await orderRepository.listPendingQuizzes();

  let enqueued = 0;
  for (const quiz of pending) {
    const data: QuizJobData = { quizId: quiz.id };
    const id = await boss.send(QUIZ_QUEUE, data, { singletonKey: quiz.id });
    if (id !== null) enqueued++;
  }

  return enqueued;
}
