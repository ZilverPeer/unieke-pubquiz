/**
 * Unit tests for retryQuiz (ticket #42's --retry-quiz flag), no DB: a fake
 * OrderRepository and a fake enqueue function.
 */
import { describe, expect, it, vi } from "vitest";
import type { QuizConfig, QuizRecord, QuizStatus } from "@/domain";
import type { OrderRepository } from "@/repository";
import { retryQuiz } from "./retry-quiz";

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
    status: "failed",
    failureReason: "boom",
    compositionId: null,
    downloadToken: null,
    deliveredAt: null,
    ...overrides,
  };
}

function buildFakeOrderRepository(quiz: QuizRecord | null): OrderRepository & {
  transitionedTo?: QuizStatus;
} {
  const repo: OrderRepository & { transitionedTo?: QuizStatus } = {
    upsertOrder: () => {
      throw new Error("upsertOrder should not be reachable in this test");
    },
    transitionQuizStatus: async (quizId, to) => {
      repo.transitionedTo = to;
      return { ...(quiz ?? buildQuiz()), id: quizId, status: to };
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
    getQuizById: async () => quiz,
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
    getQuizByCompositionId: () => {
      throw new Error("getQuizByCompositionId should not be reachable in this test");
    },
  };
  return repo;
}

describe("retryQuiz", () => {
  it("moves a failed Quiz to pending and enqueues a job", async () => {
    const quiz = buildQuiz({ status: "failed" });
    const orderRepository = buildFakeOrderRepository(quiz);
    const enqueue = vi.fn().mockResolvedValue("job-1");

    const result = await retryQuiz(quiz.id, { orderRepository, enqueue });

    expect(result.exitCode).toBe(0);
    expect(orderRepository.transitionedTo).toBe("pending");
    expect(enqueue).toHaveBeenCalledWith(quiz.id);
  });

  it("refuses a Quiz that isn't failed, without enqueueing", async () => {
    const quiz = buildQuiz({ status: "delivered" });
    const orderRepository = buildFakeOrderRepository(quiz);
    const enqueue = vi.fn();

    const result = await retryQuiz(quiz.id, { orderRepository, enqueue });

    expect(result.exitCode).toBe(1);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("refuses an unknown Quiz id", async () => {
    const orderRepository = buildFakeOrderRepository(null);
    const enqueue = vi.fn();

    const result = await retryQuiz("nope", { orderRepository, enqueue });

    expect(result.exitCode).toBe(1);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
