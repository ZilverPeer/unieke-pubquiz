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
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CategoryPick, QuizConfig } from "@/domain";
import { DELIVERABLE_FILES } from "@/domain";
import type { Deliverer } from "@/deliver";
import {
  createDeliverableUploader,
  createOrderRepository,
  createRepository,
  resolveLocalStackConfig,
} from "@/repository";
import type { Database } from "@/repository/database.types";
import { resolveFfmpeg } from "@/render";
import { handleQuizJob, type QuizJobDeps, type QuizJobLike } from "@/worker/quiz-job";
import { recomposeQuiz } from "./recompose-quiz";

const config = resolveLocalStackConfig();
const orderRepository = createOrderRepository(config);
const contentRepository = createRepository(config);
const uploadDeliverable = createDeliverableUploader(config);

const db: SupabaseClient<Database> = createClient(config.url, config.serviceRoleKey);

let nextWooOrderId = 900_000;
function freshWooOrderId(): number {
  return nextWooOrderId++;
}

function freshEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`;
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
    appBaseUrl: "http://localhost:3000",
  };
}

async function deliverFreshQuiz(prefix: string): Promise<{ quizId: string; compositionId: string }> {
  const quizId = await insertPendingQuiz(freshEmail(prefix));
  const job: QuizJobLike = { data: { quizId }, retryCount: 0, retryLimit: 3 };
  await handleQuizJob(job, buildJobDeps());
  const quiz = await orderRepository.getQuizById(quizId);
  if (!quiz?.compositionId) throw new Error("test setup failed: Quiz was not delivered");
  return { quizId, compositionId: quiz.compositionId };
}

async function listDeliverableObjects(quizId: string): Promise<{ name: string; size: number }[]> {
  const { data, error } = await db.storage.from("deliverables").list(quizId);
  if (error) throw error;
  return data.map((object) => ({ name: object.name, size: (object.metadata as { size: number })?.size }));
}

async function countCompositions(): Promise<number> {
  const { count, error } = await db.from("compositions").select("*", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

beforeEach(async () => {
  const { error: quizzesError } = await db.from("quizzes").delete().not("id", "is", null);
  if (quizzesError) throw quizzesError;
  const { error: ordersError } = await db.from("orders").delete().not("id", "is", null);
  if (ordersError) throw ordersError;
  const { error: compositionsError } = await db.from("compositions").delete().not("id", "is", null);
  if (compositionsError) throw compositionsError;
});

describe.skipIf(resolveFfmpeg() === null)("recomposeQuiz (needs ffmpeg)", () => {
  it("re-renders and re-uploads the same Deliverables without a new Composition row, and calls the deliverer once with four files", async () => {
    const { quizId, compositionId } = await deliverFreshQuiz("recompose-happy");

    const objectsBefore = await listDeliverableObjects(quizId);
    const compositionsBefore = await countCompositions();

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

    const compositionsAfter = await countCompositions();
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
});
