/**
 * Unit tests for recomposeQuiz's refusal paths (ticket #42's --composition
 * flag), no DB and no rendering: fakes short-circuit before renderQuizFiles
 * would ever run, so these never need ffmpeg. The full round trip (real
 * render, real upload, fake Deliverer) is covered by
 * generate.integration.test.ts against the real stack.
 */
import { describe, expect, it, vi } from "vitest";
import type { CompositionRecord, QuizConfig, QuizRecord } from "@/domain";
import type { Deliverer } from "@/deliver";
import type { ContentRepository, OrderRepository } from "@/repository";
import { recomposeQuiz } from "./recompose-quiz";

function buildCompositionRecord(overrides: Partial<CompositionRecord> = {}): CompositionRecord {
  return {
    billingEmail: "recompose-test@example.com",
    locale: "nl",
    quizMode: "mixed",
    requestedDifficulty: "mixed",
    seed: 1,
    composition: { slots: new Array(8).fill([]) },
    ...overrides,
  };
}

function buildQuiz(overrides: Partial<QuizRecord> = {}): QuizRecord {
  const config: QuizConfig = {
    locale: "nl",
    quizMode: "mixed",
    categoryPicks: new Array(8).fill(undefined),
    requestedDifficulty: "mixed",
  };
  return {
    id: "quiz-1",
    orderId: "order-1",
    wooLineItemId: 1,
    sequence: 0,
    config,
    status: "delivered",
    failureReason: null,
    compositionId: "composition-1",
    downloadToken: "token-1",
    deliveredAt: new Date().toISOString(),
    ...overrides,
  };
}

function buildFakeContentRepository(
  compositionRecord: CompositionRecord | null,
): ContentRepository {
  return {
    loadPool: () => {
      throw new Error("loadPool should not be reachable in this test");
    },
    loadExcludedItemIds: () => {
      throw new Error("loadExcludedItemIds should not be reachable in this test");
    },
    persistComposition: () => {
      throw new Error("persistComposition should not be reachable in this test");
    },
    getCompositionById: async () => compositionRecord,
    downloadPicture: () => {
      throw new Error("downloadPicture should not be reachable in this test");
    },
    downloadMusicClip: () => {
      throw new Error("downloadMusicClip should not be reachable in this test");
    },
  };
}

function buildFakeOrderRepository(quiz: QuizRecord | null): OrderRepository {
  return {
    upsertOrder: () => {
      throw new Error("upsertOrder should not be reachable in this test");
    },
    transitionQuizStatus: () => {
      throw new Error("transitionQuizStatus should not be reachable in this test");
    },
    recordDelivery: () => {
      throw new Error("recordDelivery should not be reachable in this test");
    },
    clearDownloadToken: () => {
      throw new Error("clearDownloadToken should not be reachable in this test");
    },
    listQuizzesByBillingEmail: () => {
      throw new Error("listQuizzesByBillingEmail should not be reachable in this test");
    },
    listQuizzesDeliveredBefore: () => {
      throw new Error("listQuizzesDeliveredBefore should not be reachable in this test");
    },
    getQuizById: () => {
      throw new Error("getQuizById should not be reachable in this test");
    },
    getQuizByDownloadToken: () => {
      throw new Error("getQuizByDownloadToken should not be reachable in this test");
    },
    listPendingQuizzes: () => {
      throw new Error("listPendingQuizzes should not be reachable in this test");
    },
    getOrderById: () => {
      throw new Error("getOrderById should not be reachable in this test");
    },
    listFailedQuizzes: () => {
      throw new Error("listFailedQuizzes should not be reachable in this test");
    },
    getQuizByCompositionId: async () => quiz,
  };
}

function buildDeps(compositionRecord: CompositionRecord | null, quiz: QuizRecord | null) {
  const fakeDeliverer: Deliverer = {
    deliverQuiz: vi.fn().mockResolvedValue(undefined),
    noteFailure: vi.fn().mockResolvedValue(undefined),
  };
  const uploadDeliverable = vi.fn().mockResolvedValue(undefined);
  return {
    contentRepository: buildFakeContentRepository(compositionRecord),
    orderRepository: buildFakeOrderRepository(quiz),
    uploadDeliverable,
    createDeliverer: () => fakeDeliverer,
    appBaseUrl: "http://localhost:3000",
    fakeDeliverer,
  };
}

describe("recomposeQuiz refusal paths", () => {
  it("refuses an unknown Composition id", async () => {
    const deps = buildDeps(null, null);

    const result = await recomposeQuiz("nope", deps);

    expect(result.exitCode).toBe(1);
    expect(deps.uploadDeliverable).not.toHaveBeenCalled();
  });

  it("refuses a Composition with no owning Quiz", async () => {
    const deps = buildDeps(buildCompositionRecord(), null);

    const result = await recomposeQuiz("composition-1", deps);

    expect(result.exitCode).toBe(1);
    expect(deps.uploadDeliverable).not.toHaveBeenCalled();
  });

  it("refuses a Quiz whose download token has been pruned", async () => {
    const deps = buildDeps(buildCompositionRecord(), buildQuiz({ downloadToken: null }));

    const result = await recomposeQuiz("composition-1", deps);

    expect(result.exitCode).toBe(1);
    expect(deps.uploadDeliverable).not.toHaveBeenCalled();
  });
});
