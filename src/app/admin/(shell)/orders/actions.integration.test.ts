/**
 * Integration tests for the Orders support view's read model and its one
 * write action (spec 4, ticket #93). Runs against the real local Supabase
 * stack -- see src/repository/README.md for the run sequence. The retry
 * suite touches a real pg-boss instance (through the action's own
 * boss-client.ts singleton), so this file is run alone, never concurrently
 * with the worker suite (admin-common brief).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PgBoss } from "pg-boss";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { OperatorSession } from "@/admin/auth/session";
import type { QuizConfig } from "@/domain";
import { createOrderRepository, createRepository, resolveLocalStackConfig } from "@/repository";
import type { Database } from "@/repository/database.types";
import { QUIZ_QUEUE, resolveDatabaseUrl } from "@/worker/boss";
import { createScopedCleanup } from "@/test-support/scoped-cleanup";
import { findOrders, loadOrderDetail } from "@/repository/admin/orders";
import { retryQuiz } from "./actions";
import { closeBossForTests } from "./boss-client";

const config = resolveLocalStackConfig();
const orderRepository = createOrderRepository(config);
const contentRepository = createRepository(config);
// Raw client for test arrangement/verification only.
const db: SupabaseClient<Database> = createClient(config.url, config.serviceRoleKey);

const cleanup = createScopedCleanup(db);

afterEach(async () => {
  await cleanup.cleanup();
});

afterAll(async () => {
  await closeBossForTests();
});

const stubOperator: OperatorSession = { email: "operator@example.com" };
const stubDeps = { assertOperator: async () => stubOperator };

let nextWooOrderId = 950_000;
function freshWooOrderId(): number {
  return nextWooOrderId++;
}

function freshEmail(prefix: string): string {
  return cleanup.trackEmail(`${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`);
}

const FULLY_RANDOM_PICKS: string[] = [];

function buildConfig(overrides: Partial<QuizConfig> = {}): QuizConfig {
  return {
    locale: "nl",
    categoryPicks: FULLY_RANDOM_PICKS,
    requestedDifficulty: "mixed",
    ...overrides,
  };
}

async function placeOrder(
  billingEmail: string,
  config: QuizConfig = buildConfig(),
): Promise<{ orderId: string; wooOrderId: number; quizId: string }> {
  const wooOrderId = freshWooOrderId();
  const { order, quizzes } = await orderRepository.upsertOrder({
    wooOrderId,
    billingEmail,
    wooStatus: "processing",
    rawPayload: { id: wooOrderId },
    lineItems: [{ wooLineItemId: 1, quantity: 1, config }],
  });
  return { orderId: order.id, wooOrderId, quizId: quizzes[0].id };
}

async function failQuiz(quizId: string): Promise<void> {
  await orderRepository.transitionQuizStatus(quizId, "generating");
  await orderRepository.transitionQuizStatus(quizId, "failed", { failureReason: "no reason, test fixture" });
}

describe("findOrders", () => {
  it("looking up by WooCommerce order number and by billing email return the same Order", async () => {
    const email = freshEmail("orders-lookup");
    const { orderId, wooOrderId } = await placeOrder(email);

    const byNumber = await findOrders(db, { query: String(wooOrderId) });
    const byEmail = await findOrders(db, { query: email });

    expect(byNumber).toHaveLength(1);
    expect(byNumber[0].id).toBe(orderId);
    expect(byEmail).toHaveLength(1);
    expect(byEmail[0].id).toBe(orderId);
  });

  it("an invalid query matches nothing", async () => {
    const result = await findOrders(db, { query: "not-a-number-or-email" });
    expect(result).toEqual([]);
  });
});

describe("loadOrderDetail", () => {
  it("lists the Order's Quizzes with status, failure reason and delivery date, in order-wide sequence", async () => {
    const email = freshEmail("orders-detail");
    const { orderId, quizId } = await placeOrder(email);
    await failQuiz(quizId);

    const detail = await loadOrderDetail(db, orderId);

    expect(detail).not.toBeNull();
    expect(detail!.quizzes).toHaveLength(1);
    const [quiz] = detail!.quizzes;
    expect(quiz.number).toBe(1);
    expect(quiz.status).toBe("failed");
    expect(quiz.failureReason).toBe("no reason, test fixture");
    expect(quiz.deliveredAt).toBeNull();
    expect(quiz.hasDownloadToken).toBe(false);
    expect(quiz.slots).toBeNull();
  });

  it("resolves a Quiz's Composition to Category names and Items' answer text in the Quiz's Locale", async () => {
    const email = freshEmail("orders-detail-composition");
    const pool = await contentRepository.loadPool("nl");
    const textEntry = pool.find((entry) => entry.item.kind === "text");
    if (!textEntry) throw new Error("test fixture: seed pool has no Text Item for locale nl");

    const { compositionId } = await contentRepository.persistComposition({
      billingEmail: email,
      locale: "nl",
      requestedDifficulty: "mixed",
      seed: 1,
      composition: { slots: [[textEntry.item.id], [], [], [], [], [], [], []] },
    });

    const { orderId } = await placeOrder(email);
    const { error } = await db.from("quizzes").update({ composition_id: compositionId }).eq("order_id", orderId);
    if (error) throw error;

    const detail = await loadOrderDetail(db, orderId);

    expect(detail!.quizzes[0].slots).not.toBeNull();
    const [slot] = detail!.quizzes[0].slots!;
    expect(slot.slotIndex).toBe(0);
    expect(slot.kind).toBe("text");
    expect(slot.categoryName).toBe(textEntry.categoryName);
    expect(slot.items).toEqual([{ itemId: textEntry.item.id, answerText: textEntry.translation.answer }]);
  });
});

describe("retryQuiz", () => {
  it("moves a failed Quiz back to pending and enqueues exactly one job", async () => {
    const boss = new PgBoss(resolveDatabaseUrl());
    await boss.start();
    try {
      const email = freshEmail("orders-retry-success");
      const { quizId } = await placeOrder(email);
      await failQuiz(quizId);

      const result = await retryQuiz(quizId, stubDeps);
      expect(result.ok).toBe(true);

      const quiz = await orderRepository.getQuizById(quizId);
      expect(quiz?.status).toBe("pending");

      // A live job for this Quiz already exists (the action's own enqueue);
      // sending a second one with the same singletonKey is refused (returns
      // null), proving exactly one job was enqueued -- same technique as
      // src/worker/quiz-job.integration.test.ts's own singleton-key test.
      const second = await boss.send(QUIZ_QUEUE, { quizId }, { singletonKey: quizId });
      expect(second).toBeNull();
    } finally {
      await boss.stop({ graceful: false });
    }
  }, 20_000);

  it("refuses to retry a delivered Quiz", async () => {
    const email = freshEmail("orders-retry-refused");
    const { quizId } = await placeOrder(email);
    // recordDelivery's compositionId is a real FK -- insert a throwaway
    // Composition row under the same billing email, so this suite's scoped
    // cleanup (which deletes compositions by billing email) reaches it too.
    const { compositionId } = await contentRepository.persistComposition({
      billingEmail: email,
      locale: "nl",
      requestedDifficulty: "mixed",
      seed: 1,
      composition: { slots: [[], [], [], [], [], [], [], []] },
    });
    await orderRepository.transitionQuizStatus(quizId, "generating");
    await orderRepository.recordDelivery(quizId, { compositionId, downloadToken: "token" });

    const result = await retryQuiz(quizId, stubDeps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.quizId).toBe("retryRefused");
    }

    const quiz = await orderRepository.getQuizById(quizId);
    expect(quiz?.status).toBe("delivered");
  });
});
