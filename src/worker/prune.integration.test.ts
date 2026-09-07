/**
 * Integration tests for the daily pruning job (spec #36, ticket #42). Runs
 * against the real local Supabase stack -- see src/repository/README.md for
 * the run sequence. Builds real delivered/failed Quizzes via handleQuizJob
 * (nothing about sample/render is mocked, only the Deliverer -- see
 * quiz-job.integration.test.ts for the same convention) and backdates
 * `delivered_at` directly with the service-role client, which is test-only
 * (see the ticket brief).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";
import type { CategoryPick, QuizConfig } from "@/domain";
import { DOWNLOAD_VALIDITY_DAYS } from "@/domain";
import type { Deliverer } from "@/deliver";
import {
  createDeliverableRemover,
  createDeliverableUploader,
  createOrderRepository,
  createRepository,
  resolveLocalStackConfig,
} from "@/repository";
import type { Database } from "@/repository/database.types";
import { resolveFfmpeg } from "@/render";
import { handleQuizJob, type QuizJobDeps, type QuizJobLike } from "./quiz-job";
import { pruneDeliverables } from "./prune";

const config = resolveLocalStackConfig();
const orderRepository = createOrderRepository(config);
const contentRepository = createRepository(config);
const uploadDeliverable = createDeliverableUploader(config);
const removeDeliverables = createDeliverableRemover(config);

const db: SupabaseClient<Database> = createClient(config.url, config.serviceRoleKey);

let nextWooOrderId = 600_000;
function freshWooOrderId(): number {
  return nextWooOrderId++;
}

function freshEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`;
}

const FULLY_RANDOM_PICKS: CategoryPick[] = new Array(8).fill(undefined);

function buildConfig(overrides: Partial<QuizConfig> = {}): QuizConfig {
  return {
    locale: "nl",
    quizMode: "mixed",
    categoryPicks: FULLY_RANDOM_PICKS,
    requestedDifficulty: "mixed",
    ...overrides,
  };
}

async function insertPendingQuiz(billingEmail: string, config: QuizConfig): Promise<string> {
  const wooOrderId = freshWooOrderId();
  const { quizzes } = await orderRepository.upsertOrder({
    wooOrderId,
    billingEmail,
    wooStatus: "processing",
    rawPayload: { id: wooOrderId },
    lineItems: [{ wooLineItemId: 1, quantity: 1, config }],
  });
  return quizzes[0].id;
}

const noopDeliverer: Deliverer = {
  deliverQuiz: async () => {},
  noteFailure: async () => {},
};

function buildDeps(): QuizJobDeps {
  return {
    orderRepository,
    contentRepository,
    uploadDeliverable,
    deliverer: noopDeliverer,
    appBaseUrl: "http://localhost:3000",
  };
}

async function deliverFreshQuiz(prefix: string): Promise<string> {
  const quizId = await insertPendingQuiz(freshEmail(prefix), buildConfig());
  const job: QuizJobLike = { data: { quizId }, retryCount: 0, retryLimit: 3 };
  await handleQuizJob(job, buildDeps());
  return quizId;
}

async function backdateDeliveredAt(quizId: string, daysAgo: number): Promise<void> {
  const deliveredAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const { error } = await db.from("quizzes").update({ delivered_at: deliveredAt.toISOString() }).eq("id", quizId);
  if (error) throw error;
}

async function listDeliverableObjectNames(quizId: string): Promise<string[]> {
  const { data, error } = await db.storage.from("deliverables").list(quizId);
  if (error) throw error;
  return data.map((object) => object.name).sort();
}

beforeEach(async () => {
  const { error: quizzesError } = await db.from("quizzes").delete().not("id", "is", null);
  if (quizzesError) throw quizzesError;
  const { error: ordersError } = await db.from("orders").delete().not("id", "is", null);
  if (ordersError) throw ordersError;
  const { error: compositionsError } = await db.from("compositions").delete().not("id", "is", null);
  if (compositionsError) throw compositionsError;
});

describe.skipIf(resolveFfmpeg() === null)("pruneDeliverables (needs ffmpeg)", () => {
  it(`deletes objects and marks the Quiz pruned (keeping its token) for a Quiz delivered more than ${DOWNLOAD_VALIDITY_DAYS} days ago`, async () => {
    const quizId = await deliverFreshQuiz("prune-31d");
    await backdateDeliveredAt(quizId, DOWNLOAD_VALIDITY_DAYS + 1);

    const result = await pruneDeliverables({ orderRepository, removeDeliverables }, new Date());

    expect(result.prunedQuizIds).toContain(quizId);

    const objectNames = await listDeliverableObjectNames(quizId);
    expect(objectNames).toEqual([]);

    const quiz = await orderRepository.getQuizById(quizId);
    // The token is kept -- see markPruned's doc comment and CONTEXT.md
    // "Orders and Quizzes": a pruned Quiz's link must stay *recognised* so
    // the download route can answer 410 rather than 404.
    expect(quiz?.downloadToken).toBeTruthy();
    expect(quiz?.prunedAt).toBeTruthy();
    // status/compositionId stay too, so the Composition can still be
    // re-rendered on request (CONTEXT.md).
    expect(quiz?.status).toBe("delivered");
    expect(quiz?.compositionId).toBeTruthy();
  });

  it(`keeps objects and leaves the Quiz unpruned for a Quiz delivered less than ${DOWNLOAD_VALIDITY_DAYS} days ago`, async () => {
    const quizId = await deliverFreshQuiz("prune-29d");
    await backdateDeliveredAt(quizId, DOWNLOAD_VALIDITY_DAYS - 1);

    const result = await pruneDeliverables({ orderRepository, removeDeliverables }, new Date());

    expect(result.prunedQuizIds).not.toContain(quizId);

    const objectNames = await listDeliverableObjectNames(quizId);
    expect(objectNames).toEqual(
      ["answer-sheet.pdf", "music-round.mp3", "picture-handout.pdf", "quizmaster.pdf"].sort(),
    );

    const quiz = await orderRepository.getQuizById(quizId);
    expect(quiz?.downloadToken).toBeTruthy();
    expect(quiz?.prunedAt).toBeNull();
  });

  it("deletes leftover objects of a failed Quiz", async () => {
    // Same shortfall fixture as quiz-job.integration.test.ts's own shortfall
    // case: uploads for slot 0's rendering attempt happen before the sampler
    // discovers slot 1's shortfall -- wait, actually the shortfall is caught
    // before any upload happens (generateQuiz uploads only after every slot
    // is rendered). To exercise "leftover objects of a failed Quiz" for
    // real, this test uploads directly and then fails the Quiz, mirroring
    // the "mid-upload failure on the last attempt" known limitation
    // (src/worker/README.md).
    const quizId = await insertPendingQuiz(freshEmail("prune-failed"), buildConfig());
    await orderRepository.transitionQuizStatus(quizId, "generating");
    await uploadDeliverable(`${quizId}/quizmaster.pdf`, new Uint8Array([1, 2, 3]), "application/pdf");
    await orderRepository.transitionQuizStatus(quizId, "failed", { failureReason: "test: simulated mid-upload failure" });

    const objectsBefore = await listDeliverableObjectNames(quizId);
    expect(objectsBefore).toEqual(["quizmaster.pdf"]);

    const result = await pruneDeliverables({ orderRepository, removeDeliverables }, new Date());

    expect(result.cleanedFailedQuizIds).toContain(quizId);
    const objectsAfter = await listDeliverableObjectNames(quizId);
    expect(objectsAfter).toEqual([]);
  });

  it("keeps pruning the rest of the batch when one Quiz's removal throws, and reports it as a failure", async () => {
    const failingQuizId = await deliverFreshQuiz("prune-throws");
    await backdateDeliveredAt(failingQuizId, DOWNLOAD_VALIDITY_DAYS + 1);
    const okQuizId = await deliverFreshQuiz("prune-ok");
    await backdateDeliveredAt(okQuizId, DOWNLOAD_VALIDITY_DAYS + 1);

    const throwingRemover = async (storagePaths: readonly string[]): Promise<void> => {
      if (storagePaths[0]?.startsWith(`${failingQuizId}/`)) {
        throw new Error("simulated Storage failure");
      }
      await removeDeliverables(storagePaths);
    };

    const result = await pruneDeliverables({ orderRepository, removeDeliverables: throwingRemover }, new Date());

    expect(result.failedQuizIds).toEqual([failingQuizId]);
    expect(result.prunedQuizIds).toEqual([okQuizId]);

    const failingQuiz = await orderRepository.getQuizById(failingQuizId);
    expect(failingQuiz?.downloadToken).toBeTruthy();
    expect(failingQuiz?.prunedAt).toBeNull();

    const okQuiz = await orderRepository.getQuizById(okQuizId);
    expect(okQuiz?.downloadToken).toBeTruthy();
    expect(okQuiz?.prunedAt).toBeTruthy();
  });

  it("running twice is safe (no error pruning an already-pruned Quiz)", async () => {
    const quizId = await deliverFreshQuiz("prune-idempotent");
    await backdateDeliveredAt(quizId, DOWNLOAD_VALIDITY_DAYS + 1);

    await pruneDeliverables({ orderRepository, removeDeliverables }, new Date());
    const second = await pruneDeliverables({ orderRepository, removeDeliverables }, new Date());

    // Already pruned: markPruned already ran, so listQuizzesDeliveredBefore
    // (which requires prunedAt still null) no longer returns it.
    expect(second.prunedQuizIds).not.toContain(quizId);
  });
});
