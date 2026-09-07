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
 *
 * If `enqueueQuizJob` throws after `upsertOrder` has already committed, this
 * function rejects and route.ts turns that into a 500; WooCommerce retries
 * the delivery on its own schedule, and redelivery is safe by the same
 * idempotency described above. See README.md.
 */
import type { QuizRecord } from "@/domain";
import type { OrderRepository } from "@/repository";
import { QuizStatusChangedConcurrentlyError } from "@/repository";
import { parseOrderPayload } from "./parse-order";
import { verifySignature } from "./verify-signature";

export interface WebhookDeps {
  secret: string;
  orderRepository: Pick<OrderRepository, "upsertOrder" | "transitionQuizStatus" | "getQuizById">;
  loadCategoryIds: () => Promise<Set<string>>;
  /** Sends one pg-boss job for this Quiz id, singletonKey = quizId. No-op if one is already queued/active. */
  enqueueQuizJob: (quizId: string) => Promise<void>;
  /**
   * Adds the shop's operator-alert order note for a Quiz that failed to
   * parse at webhook time (spec #36 stories 16/27) -- the same note every
   * other `failed` path posts via Deliverer.noteFailure (see failQuiz,
   * src/worker/quiz-job.ts). Wired lazily in route.ts, only once a failure
   * actually needs noting, so a machine without WOOCOMMERCE_* env vars can
   * still receive happy-path webhooks.
   */
  noteFailure: (input: { quizId: string; reason: string }) => Promise<void>;
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
    await failQuiz(deps, quiz.id, error);
    return;
  }

  await deps.enqueueQuizJob(quiz.id);
}

/**
 * Marks a Quiz `failed` and notes why, mirroring failQuiz in
 * src/worker/quiz-job.ts: `transitionQuizStatus` re-reads and validates the
 * edge itself, so this only needs to special-case a lost compare-and-swap
 * race (QuizStatusChangedConcurrentlyError) -- re-read before deciding
 * whether there's anything left to do, rather than assume the race means
 * anything in particular. A `noteFailure` failure is logged and swallowed:
 * the Quiz is already `failed` in the repository either way, and neither
 * the sweep nor a redelivery would get a second chance to note it (this
 * settleQuiz path only runs for a Quiz still `pending`).
 */
async function failQuiz(deps: WebhookDeps, quizId: string, reason: string): Promise<void> {
  try {
    await deps.orderRepository.transitionQuizStatus(quizId, "failed", { failureReason: reason });
  } catch (error) {
    if (!(error instanceof QuizStatusChangedConcurrentlyError)) {
      throw error;
    }

    const current = await deps.orderRepository.getQuizById(quizId);
    if (current?.status === "failed" || current?.status === "delivered") {
      // Another writer already moved it somewhere terminal -- a concurrent
      // `failed` already ran its own noteFailure; a concurrent `delivered`
      // means generation won the race after all. Either way, nothing left
      // for this delivery to do.
      return;
    }
    // Still live (pending/generating): the race is worth one retry.
    await deps.orderRepository.transitionQuizStatus(quizId, "failed", { failureReason: reason });
  }

  try {
    await deps.noteFailure({ quizId, reason });
  } catch (error) {
    console.error(`webhook: noteFailure failed for Quiz ${quizId}`, error);
  }
}
