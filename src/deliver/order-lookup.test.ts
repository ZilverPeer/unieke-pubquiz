import { describe, expect, test, vi } from "vitest";
import type { OrderRecord, QuizRecord } from "@/domain";
import type { OrderRepository } from "@/repository";
import { createOrderLookup } from "./order-lookup";

function fakeQuiz(overrides: Partial<QuizRecord> = {}): QuizRecord {
  return {
    id: "quiz-1",
    orderId: "order-1",
    wooLineItemId: 42,
    sequence: 0,
    config: { locale: "nl", quizMode: "mixed", categoryPicks: [], requestedDifficulty: "mixed" },
    status: "delivered",
    failureReason: null,
    compositionId: "comp-1",
    downloadToken: "token",
    deliveredAt: new Date().toISOString(),
    ...overrides,
  };
}

function fakeOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "order-1",
    wooOrderId: 123,
    billingEmail: "a@b.com",
    wooStatus: "processing",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Only the methods the adapter actually calls are implemented; the rest throw if hit. */
function fakeRepository(overrides: Partial<OrderRepository>): OrderRepository {
  const unimplemented = () => {
    throw new Error("not implemented in this fake");
  };
  return {
    upsertOrder: unimplemented,
    transitionQuizStatus: unimplemented,
    recordDelivery: unimplemented,
    clearDownloadToken: unimplemented,
    listQuizzesByBillingEmail: unimplemented,
    listQuizzesByOrderId: unimplemented,
    listQuizzesDeliveredBefore: unimplemented,
    getQuizById: unimplemented,
    getQuizByDownloadToken: unimplemented,
    listPendingQuizzes: unimplemented,
    getOrderById: unimplemented,
    ...overrides,
  };
}

describe("createOrderLookup", () => {
  test("resolves a Quiz's WooCommerce order id, line item id, and sibling statuses", async () => {
    const quiz = fakeQuiz({ id: "quiz-1", orderId: "order-1", wooLineItemId: 42, status: "delivered" });
    const sibling = fakeQuiz({ id: "quiz-2", orderId: "order-1", wooLineItemId: 43, status: "pending" });
    const order = fakeOrder({ id: "order-1", wooOrderId: 123 });

    const repository = fakeRepository({
      getQuizById: vi.fn().mockResolvedValue(quiz),
      getOrderById: vi.fn().mockResolvedValue(order),
      listQuizzesByOrderId: vi.fn().mockResolvedValue([quiz, sibling]),
    });

    const lookup = createOrderLookup(repository);
    const context = await lookup.forQuiz("quiz-1");

    expect(context).toEqual({
      wooOrderId: 123,
      wooLineItemId: 42,
      siblingStatuses: ["delivered", "pending"],
    });
    expect(repository.listQuizzesByOrderId).toHaveBeenCalledWith("order-1");
  });

  test("throws when the Quiz does not exist", async () => {
    const repository = fakeRepository({ getQuizById: vi.fn().mockResolvedValue(null) });
    const lookup = createOrderLookup(repository);
    await expect(lookup.forQuiz("missing")).rejects.toThrow(/missing/);
  });

  test("throws when the Quiz's order does not exist", async () => {
    const repository = fakeRepository({
      getQuizById: vi.fn().mockResolvedValue(fakeQuiz({ orderId: "order-1" })),
      getOrderById: vi.fn().mockResolvedValue(null),
    });
    const lookup = createOrderLookup(repository);
    await expect(lookup.forQuiz("quiz-1")).rejects.toThrow(/order-1/);
  });
});
