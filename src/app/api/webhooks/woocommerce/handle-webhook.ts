/**
 * The webhook's decision logic (spec #36, ticket #39), factored out of
 * route.ts so it can be unit tested with faked repository/pg-boss deps
 * (mirrors src/app/download/resolve-download.ts's split from its route.ts).
 *
 * Order of checks matters: signature first (a bad signature must persist
 * and enqueue nothing), then the `processing` status gate (same guarantee),
 * only then does anything touch the repository.
 *
 * Enqueueing: a Quiz row the repository just returned as still `pending`
 * (i.e. it wasn't inserted just now as `failed` by this call, and hadn't
 * already moved on from a prior delivery) gets a job sent with its id as
 * `singletonKey`. pg-boss's `exclusive` queue policy (src/worker/boss.ts)
 * makes a second `send()` for the same Quiz id a no-op while a job is still
 * queued or active, so redelivering the same payload is safe to run through
 * this same path every time -- no separate "is this a redelivery" branch.
 */
import type { QuizRecord } from "@/domain";
import type { OrderRepository } from "@/repository";
import { parseOrderPayload } from "./parse-order";
import { verifySignature } from "./verify-signature";

export interface WebhookDeps {
  secret: string;
  orderRepository: Pick<OrderRepository, "upsertOrder" | "transitionQuizStatus">;
  loadCategoryIds: () => Promise<Set<string>>;
  /** Sends one pg-boss job for this Quiz id, singletonKey = quizId. No-op if one is already queued/active. */
  enqueueQuizJob: (quizId: string) => Promise<void>;
}

export interface WebhookResult {
  status: 200 | 400 | 401;
}

function parseJson(rawBody: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(rawBody) };
  } catch {
    return { ok: false };
  }
}

export async function handleWebhook(
  rawBody: string,
  signatureHeader: string | null,
  deps: WebhookDeps,
): Promise<WebhookResult> {
  if (!verifySignature(rawBody, signatureHeader, deps.secret)) {
    return { status: 401 };
  }

  const parsedJson = parseJson(rawBody);
  if (!parsedJson.ok) {
    return { status: 400 };
  }

  const payload = parsedJson.value as { status?: unknown };
  if (payload.status !== "processing") {
    return { status: 200 };
  }

  const categoryIds = await deps.loadCategoryIds();
  const { input, lineItemErrors } = parseOrderPayload(payload, categoryIds);

  const { quizzes } = await deps.orderRepository.upsertOrder(input);

  await Promise.all(quizzes.map((quiz) => settleQuiz(deps, quiz, lineItemErrors)));

  return { status: 200 };
}

async function settleQuiz(
  deps: WebhookDeps,
  quiz: QuizRecord,
  lineItemErrors: ReadonlyMap<number, string>,
): Promise<void> {
  // Only a Quiz this delivery's upsertOrder returned as still "pending" is
  // ours to settle -- one already moved on (by a worker, or by an earlier
  // delivery already failing it) is left untouched.
  if (quiz.status !== "pending") return;

  const error = lineItemErrors.get(quiz.wooLineItemId);
  if (error) {
    await deps.orderRepository.transitionQuizStatus(quiz.id, "failed", { failureReason: error });
    return;
  }

  await deps.enqueueQuizJob(quiz.id);
}
