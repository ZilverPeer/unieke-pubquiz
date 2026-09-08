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
    config: { locale: "nl", categoryPicks: [], requestedDifficulty: "mixed" },
    status: "delivered",
    failureReason: null,
    compositionId: "comp-1",
    downloadToken: "token",
    deliveredAt: new Date().toISOString(),
    prunedAt: null,
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
    markPruned: unimplemented,
    clearPruned: unimplemented,
    listQuizzesByBillingEmail: unimplemented,
    listQuizzesByOrderId: unimplemented,
    listQuizzesDeliveredBefore: unimplemented,
    getQuizById: unimplemented,
    getQuizByDownloadToken: unimplemented,
    listPendingQuizzes: unimplemented,
    getOrderById: unimplemented,
    listFailedQuizzes: unimplemented,
    getQuizByCompositionId: unimplemented,
    ...overrides,
  };
}

describe("createOrderLookup", () => {
  test("resolves a Quiz's WooCommerce order id, line item id, and its order-wide sibling position", async () => {
    // quiz.sequence (1) is deliberately NOT what "sequence" on the context
    // should equal -- it's a per-line-item value; the context's "sequence"
    // is the Quiz's 0-based position in listQuizzesByOrderId's own order
    // (orderWideQuizSequence), here 0 since "quiz-1" comes first.
    const quiz = fakeQuiz({ id: "quiz-1", orderId: "order-1", wooLineItemId: 42, sequence: 1, status: "delivered" });
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
      sequence: 0,
      siblingStatuses: ["delivered", "pending"],
    });
    expect(repository.listQuizzesByOrderId).toHaveBeenCalledWith("order-1");
  });

  test("gives the second Quiz in listQuizzesByOrderId's order the next order-wide sequence, even though its own quizzes.sequence is also 0", async () => {
    // Reproduces the bug directly at this seam: two Quizzes on two
    // different line items both have quizzes.sequence 0 (the field
    // restarts per line item); the context's "sequence" must still be
    // distinct.
    const first = fakeQuiz({ id: "quiz-1", orderId: "order-1", wooLineItemId: 1, sequence: 0, status: "delivered" });
    const second = fakeQuiz({ id: "quiz-2", orderId: "order-1", wooLineItemId: 2, sequence: 0, status: "delivered" });
    const order = fakeOrder({ id: "order-1", wooOrderId: 123 });

    const repository = fakeRepository({
      getQuizById: vi.fn().mockResolvedValue(second),
      getOrderById: vi.fn().mockResolvedValue(order),
      listQuizzesByOrderId: vi.fn().mockResolvedValue([first, second]),
    });

    const lookup = createOrderLookup(repository);
    const context = await lookup.forQuiz("quiz-2");

    expect(context.sequence).toBe(1);
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
