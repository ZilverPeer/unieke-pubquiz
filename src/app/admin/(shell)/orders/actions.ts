"use server";
/**
 * Orders support view server actions (spec 4, ticket #93). Only one write:
 * retrying a failed Quiz, through the same core src/scripts/retry-quiz.ts
 * the CLI's `--retry-quiz` flag uses (transition failed -> pending, then
 * enqueue), never duplicated here.
 */
import { QUIZ_QUEUE } from "@/worker/boss";
import { createOrderRepository, resolveLocalStackConfig } from "@/repository";
import { retryQuiz as retryQuizCore } from "@/scripts/retry-quiz";
import { assertOperator as assertOperatorReal } from "@/admin/auth/session";
import { fail, succeed, type ActionResult } from "@/admin/forms";
import { getBoss } from "./boss-client";

export interface RetryQuizDeps {
  assertOperator: typeof assertOperatorReal;
}

const defaultDeps: RetryQuizDeps = { assertOperator: assertOperatorReal };

/**
 * Moves a `failed` Quiz back to `pending` and re-enqueues its generation
 * job. Refused (an `errors.quizId` field error) when the Quiz doesn't
 * exist or isn't currently `failed` -- mirrors retryQuizCore's own refusal,
 * see src/scripts/retry-quiz.ts.
 */
export async function retryQuiz(quizId: string, deps: RetryQuizDeps = defaultDeps): Promise<ActionResult> {
  await deps.assertOperator();

  const orderRepository = createOrderRepository(resolveLocalStackConfig());
  const boss = await getBoss();

  const result = await retryQuizCore(quizId, {
    orderRepository,
    enqueue: (id) => boss.send(QUIZ_QUEUE, { quizId: id }, { singletonKey: id }),
  });

  if (result.exitCode !== 0) {
    return fail({ quizId: "retryRefused" });
  }

  return succeed(undefined);
}
