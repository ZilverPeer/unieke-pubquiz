/**
 * Integration tests for recomposeQuiz (ticket #42's --composition flag).
 * Runs against the real local Supabase stack and the real render pipeline --
 * see src/repository/README.md for the run sequence. Only the Deliverer is
 * faked, injected directly (not the real, still-unimplemented
 * createDeliverer() -- see src/deliver/index.ts and
 * reprocess-cli.integration.test.ts for the CLI-level coverage of that
 * catch/print behaviour).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CategoryPick, QuizConfig } from "@/domain";
import { DELIVERABLE_FILES, DOWNLOAD_VALIDITY_DAYS } from "@/domain";
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
import { generateQuiz } from "@/scripts/generate-quiz";
import { createScopedCleanup } from "@/test-support/scoped-cleanup";
import { pruneDeliverables } from "@/worker/prune";
import { handleQuizJob, type QuizJobDeps, type QuizJobLike } from "@/worker/quiz-job";
import { recomposeQuiz } from "./recompose-quiz";

const config = resolveLocalStackConfig();
const orderRepository = createOrderRepository(config);
const contentRepository = createRepository(config);
const uploadDeliverable = createDeliverableUploader(config);
const removeDeliverables = createDeliverableRemover(config);

const db: SupabaseClient<Database> = createClient(config.url, config.serviceRoleKey);

// Scopes cleanup to exactly the billing emails this suite hands out via
// freshEmail(), so a real order or another suite's fixture on the same
// stack survives this run (ticket #51 -- see
// src/test-support/scoped-cleanup.ts).
const cleanup = createScopedCleanup(db);

afterEach(async () => {
  await cleanup.cleanup();
});

let nextWooOrderId = 900_000;
function freshWooOrderId(): number {
  return nextWooOrderId++;
}

function freshEmail(prefix: string): string {
  return cleanup.trackEmail(`${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`);
}

const FULLY_RANDOM_PICKS: CategoryPick[] = new Array(8).fill(undefined);

function buildConfig(): QuizConfig {
  return {
    locale: "nl",
    quizMode: "mixed",
    categoryPicks: FULLY_RANDOM_PICKS,
    requestedDifficulty: "mixed",
  };
}

async function insertPendingQuiz(billingEmail: string): Promise<string> {
  const wooOrderId = freshWooOrderId();
  const { quizzes } = await orderRepository.upsertOrder({
    wooOrderId,
    billingEmail,
    wooStatus: "processing",
    rawPayload: { id: wooOrderId },
    lineItems: [{ wooLineItemId: 1, quantity: 1, config: buildConfig() }],
  });
  return quizzes[0].id;
}

const noopDeliverer: Deliverer = {
  deliverQuiz: async () => {},
  noteFailure: async () => {},
};

function buildJobDeps(): QuizJobDeps {
  return {
    orderRepository,
    contentRepository,
    uploadDeliverable,
    deliverer: noopDeliverer,
    generateQuiz,
    appBaseUrl: "http://localhost:3000",
  };
}

async function deliverFreshQuiz(prefix: string): Promise<{ quizId: string; compositionId: string; email: string }> {
  const email = freshEmail(prefix);
  const quizId = await insertPendingQuiz(email);
  const job: QuizJobLike = { data: { quizId }, retryCount: 0, retryLimit: 3 };
  await handleQuizJob(job, buildJobDeps());
  const quiz = await orderRepository.getQuizById(quizId);
  if (!quiz?.compositionId) throw new Error("test setup failed: Quiz was not delivered");
  return { quizId, compositionId: quiz.compositionId, email };
}

async function backdateDeliveredAt(quizId: string, daysAgo: number): Promise<void> {
  const deliveredAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const { error } = await db.from("quizzes").update({ delivered_at: deliveredAt.toISOString() }).eq("id", quizId);
  if (error) throw error;
}

async function listDeliverableObjects(quizId: string): Promise<{ name: string; size: number }[]> {
  const { data, error } = await db.storage.from("deliverables").list(quizId);
  if (error) throw error;
  return data.map((object) => ({ name: object.name, size: (object.metadata as { size: number })?.size }));
}

async function countCompositions(billingEmail: string): Promise<number> {
  const { count, error } = await db
    .from("compositions")
    .select("*", { count: "exact", head: true })
    .eq("billing_email", billingEmail);
  if (error) throw error;
  return count ?? 0;
}

describe.skipIf(resolveFfmpeg() === null)("recomposeQuiz (needs ffmpeg)", () => {
  it("re-renders and re-uploads the same Deliverables without a new Composition row, and calls the deliverer once with four files", async () => {
    const { quizId, compositionId, email } = await deliverFreshQuiz("recompose-happy");

    const objectsBefore = await listDeliverableObjects(quizId);
    const compositionsBefore = await countCompositions(email);

    const fakeDeliverer: Deliverer = {
      deliverQuiz: vi.fn().mockResolvedValue(undefined),
      noteFailure: vi.fn().mockResolvedValue(undefined),
    };

    const result = await recomposeQuiz(compositionId, {
      contentRepository,
      orderRepository,
      uploadDeliverable,
      createDeliverer: () => fakeDeliverer,
      appBaseUrl: "http://localhost:3000",
    });

    expect(result.exitCode).toBe(0);

    expect(fakeDeliverer.deliverQuiz).toHaveBeenCalledTimes(1);
    const call = (fakeDeliverer.deliverQuiz as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.quizId).toBe(quizId);
    expect(call.files).toHaveLength(DELIVERABLE_FILES.length);
    expect(call.files.map((f: { file: string }) => f.file).sort()).toEqual([...DELIVERABLE_FILES].sort());

    const compositionsAfter = await countCompositions(email);
    expect(compositionsAfter).toBe(compositionsBefore);

    const objectsAfter = await listDeliverableObjects(quizId);
    expect(objectsAfter.map((o) => o.name).sort()).toEqual(objectsBefore.map((o) => o.name).sort());
    for (const after of objectsAfter) {
      expect(after.size).toBeGreaterThan(0);
    }
  });

  it("refuses a Composition with no owning Quiz", async () => {
    const { compositionId } = await contentRepository.persistComposition({
      billingEmail: freshEmail("recompose-orphan"),
      locale: "nl",
      quizMode: "mixed",
      requestedDifficulty: "mixed",
      seed: 1,
      composition: { slots: new Array(8).fill([]) },
    });

    const fakeDeliverer: Deliverer = {
      deliverQuiz: vi.fn().mockResolvedValue(undefined),
      noteFailure: vi.fn().mockResolvedValue(undefined),
    };

    const result = await recomposeQuiz(compositionId, {
      contentRepository,
      orderRepository,
      uploadDeliverable,
      createDeliverer: () => fakeDeliverer,
      appBaseUrl: "http://localhost:3000",
    });

    expect(result.exitCode).toBe(1);
    expect(fakeDeliverer.deliverQuiz).not.toHaveBeenCalled();
  });

  it("re-attaches a pruned Quiz: re-uploads its objects and clears prunedAt, re-enabling the same download link", async () => {
    const { quizId, compositionId } = await deliverFreshQuiz("recompose-pruned");
    await backdateDeliveredAt(quizId, DOWNLOAD_VALIDITY_DAYS + 1);

    const pruneResult = await pruneDeliverables({ orderRepository, removeDeliverables }, new Date());
    expect(pruneResult.prunedQuizIds).toContain(quizId);

    const prunedQuiz = await orderRepository.getQuizById(quizId);
    expect(prunedQuiz?.prunedAt).toBeTruthy();
    expect(prunedQuiz?.downloadToken).toBeTruthy();
    expect(await listDeliverableObjects(quizId)).toEqual([]);

    const fakeDeliverer: Deliverer = {
      deliverQuiz: vi.fn().mockResolvedValue(undefined),
      noteFailure: vi.fn().mockResolvedValue(undefined),
    };

    const result = await recomposeQuiz(compositionId, {
      contentRepository,
      orderRepository,
      uploadDeliverable,
      createDeliverer: () => fakeDeliverer,
      appBaseUrl: "http://localhost:3000",
    });

    expect(result.exitCode).toBe(0);
    expect(fakeDeliverer.deliverQuiz).toHaveBeenCalledTimes(1);
    const call = (fakeDeliverer.deliverQuiz as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.files.map((f: { url: string }) => f.url.includes(prunedQuiz!.downloadToken!))).toEqual(
      call.files.map(() => true),
    );

    const objectsAfter = await listDeliverableObjects(quizId);
    expect(objectsAfter.map((o) => o.name).sort()).toEqual([...DELIVERABLE_FILES].sort());

    const recomposedQuiz = await orderRepository.getQuizById(quizId);
    expect(recomposedQuiz?.prunedAt).toBeNull();
    expect(recomposedQuiz?.downloadToken).toBe(prunedQuiz?.downloadToken);
  });
});
