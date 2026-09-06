/**
 * Integration tests for the order repository (spec #36, ticket #38). Runs
 * against the real local Supabase stack -- see README.md for the run
 * sequence. Never mocks Supabase.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";
import type { CategoryPick, QuizConfig } from "@/domain";
import type { Database } from "./database.types";
import { createOrderRepository, IllegalQuizTransitionError, resolveLocalStackConfig } from "./index";

const config = resolveLocalStackConfig();
const repository = createOrderRepository(config);
// Raw client for test arrangement/verification -- the repository under test
// is only exercised through its public interface.
const db: SupabaseClient<Database> = createClient(config.url, config.serviceRoleKey);

beforeEach(async () => {
  // quizzes references orders; delete quizzes first since orders has no
  // cascade (delete-restricted while Quizzes exist, by design).
  const { error: quizzesError } = await db.from("quizzes").delete().not("id", "is", null);
  if (quizzesError) throw quizzesError;
  const { error: ordersError } = await db.from("orders").delete().not("id", "is", null);
  if (ordersError) throw ordersError;
});

let nextWooOrderId = 900_000;
function freshWooOrderId(): number {
  return nextWooOrderId++;
}

const CATEGORY_PICKS: CategoryPick[] = [
  "1",
  undefined,
  "2",
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
];

function buildConfig(overrides: Partial<QuizConfig> = {}): QuizConfig {
  return {
    locale: "nl",
    quizMode: "mixed",
    categoryPicks: CATEGORY_PICKS,
    requestedDifficulty: "mixed",
    ...overrides,
  };
}

describe("upsertOrder", () => {
  it("creates the order and one Quiz per line item unit (quantity n yields n Quizzes)", async () => {
    const wooOrderId = freshWooOrderId();

    const { order, quizzes } = await repository.upsertOrder({
      wooOrderId,
      billingEmail: "customer@example.com",
      wooStatus: "processing",
      rawPayload: { id: wooOrderId },
      lineItems: [{ wooLineItemId: 1, quantity: 2, config: buildConfig() }],
    });

    expect(order.wooOrderId).toBe(wooOrderId);
    expect(order.billingEmail).toBe("customer@example.com");
    expect(order.wooStatus).toBe("processing");
    expect(quizzes).toHaveLength(2);
    expect(quizzes.map((q) => q.sequence).sort()).toEqual([0, 1]);
    for (const quiz of quizzes) {
      expect(quiz.orderId).toBe(order.id);
      expect(quiz.wooLineItemId).toBe(1);
      expect(quiz.status).toBe("pending");
      expect(quiz.config).toEqual(buildConfig());
      expect(quiz.compositionId).toBeNull();
      expect(quiz.downloadToken).toBeNull();
      expect(quiz.deliveredAt).toBeNull();
    }
  });

  it("normalises billing email trimmed and lower-cased", async () => {
    const wooOrderId = freshWooOrderId();

    const { order } = await repository.upsertOrder({
      wooOrderId,
      billingEmail: "  Customer@Example.com  ",
      wooStatus: "processing",
      rawPayload: {},
      lineItems: [],
    });

    expect(order.billingEmail).toBe("customer@example.com");
  });

  it("is idempotent on woo order id: a second call yields the same rows, never duplicates", async () => {
    const wooOrderId = freshWooOrderId();
    const input = {
      wooOrderId,
      billingEmail: "repeat@example.com",
      wooStatus: "processing",
      rawPayload: { id: wooOrderId },
      lineItems: [{ wooLineItemId: 1, quantity: 2, config: buildConfig() }],
    };

    const first = await repository.upsertOrder(input);
    const second = await repository.upsertOrder(input);

    expect(second.order.id).toBe(first.order.id);
    expect(second.quizzes.map((q) => q.id).sort()).toEqual(first.quizzes.map((q) => q.id).sort());

    const { data, error } = await db.from("orders").select("id").eq("woo_order_id", wooOrderId);
    if (error) throw error;
    expect(data).toHaveLength(1);

    const { data: quizRows, error: quizError } = await db.from("quizzes").select("id").eq("order_id", first.order.id);
    if (quizError) throw quizError;
    expect(quizRows).toHaveLength(2);
  });

  it("never resets a Quiz that already left pending", async () => {
    const wooOrderId = freshWooOrderId();
    const input = {
      wooOrderId,
      billingEmail: "progressed@example.com",
      wooStatus: "processing",
      rawPayload: {},
      lineItems: [{ wooLineItemId: 1, quantity: 1, config: buildConfig() }],
    };

    const { quizzes } = await repository.upsertOrder(input);
    const quizId = quizzes[0].id;
    await repository.transitionQuizStatus(quizId, "generating");

    const second = await repository.upsertOrder(input);

    expect(second.quizzes).toHaveLength(1);
    expect(second.quizzes[0].id).toBe(quizId);
    expect(second.quizzes[0].status).toBe("generating");
  });

  it("updates the order's woo status and raw payload on repeated delivery", async () => {
    const wooOrderId = freshWooOrderId();
    await repository.upsertOrder({
      wooOrderId,
      billingEmail: "status-update@example.com",
      wooStatus: "processing",
      rawPayload: { id: wooOrderId, note: "first" },
      lineItems: [],
    });

    const { order } = await repository.upsertOrder({
      wooOrderId,
      billingEmail: "status-update@example.com",
      wooStatus: "completed",
      rawPayload: { id: wooOrderId, note: "second" },
      lineItems: [],
    });

    expect(order.wooStatus).toBe("completed");
  });
});

describe("transitionQuizStatus", () => {
  async function createPendingQuiz(): Promise<string> {
    const wooOrderId = freshWooOrderId();
    const { quizzes } = await repository.upsertOrder({
      wooOrderId,
      billingEmail: "transition@example.com",
      wooStatus: "processing",
      rawPayload: {},
      lineItems: [{ wooLineItemId: 1, quantity: 1, config: buildConfig() }],
    });
    return quizzes[0].id;
  }

  it("allows a legal edge (pending -> generating)", async () => {
    const quizId = await createPendingQuiz();

    const updated = await repository.transitionQuizStatus(quizId, "generating");

    expect(updated.status).toBe("generating");
  });

  it("rejects an illegal edge (delivered -> generating) with a typed error", async () => {
    const quizId = await createPendingQuiz();
    await repository.transitionQuizStatus(quizId, "generating");
    await repository.recordDelivery(quizId, { compositionId: await createComposition(), downloadToken: "tok-illegal-1" });

    await expect(repository.transitionQuizStatus(quizId, "generating")).rejects.toThrow(IllegalQuizTransitionError);
  });

  it("rejects an illegal edge (failed -> delivered) with a typed error", async () => {
    const quizId = await createPendingQuiz();
    await repository.transitionQuizStatus(quizId, "generating");
    await repository.transitionQuizStatus(quizId, "failed", { failureReason: "shortfall" });

    await expect(repository.transitionQuizStatus(quizId, "delivered")).rejects.toThrow(IllegalQuizTransitionError);
  });

  it("stores failureReason on failed and clears it on pending", async () => {
    const quizId = await createPendingQuiz();
    await repository.transitionQuizStatus(quizId, "generating");

    const failed = await repository.transitionQuizStatus(quizId, "failed", { failureReason: "no items left" });
    expect(failed.failureReason).toBe("no items left");

    const retried = await repository.transitionQuizStatus(quizId, "pending");
    expect(retried.failureReason).toBeNull();
  });
});

async function createComposition(): Promise<string> {
  const { data, error } = await db
    .from("compositions")
    .insert({
      billing_email: "composition@example.com",
      locale: "nl",
      quiz_mode: "mixed",
      requested_difficulty: "mixed",
      seed: 1,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

describe("recordDelivery", () => {
  it("sets compositionId, downloadToken and deliveredAt together with the transition to delivered", async () => {
    const wooOrderId = freshWooOrderId();
    const { quizzes } = await repository.upsertOrder({
      wooOrderId,
      billingEmail: "delivery@example.com",
      wooStatus: "processing",
      rawPayload: {},
      lineItems: [{ wooLineItemId: 1, quantity: 1, config: buildConfig() }],
    });
    const quizId = quizzes[0].id;
    await repository.transitionQuizStatus(quizId, "generating");
    const compositionId = await createComposition();

    const delivered = await repository.recordDelivery(quizId, {
      compositionId,
      downloadToken: "tok-delivery-1",
    });

    expect(delivered.status).toBe("delivered");
    expect(delivered.compositionId).toBe(compositionId);
    expect(delivered.downloadToken).toBe("tok-delivery-1");
    expect(delivered.deliveredAt).not.toBeNull();
  });

  it("rejects delivery from pending (must go through generating)", async () => {
    const wooOrderId = freshWooOrderId();
    const { quizzes } = await repository.upsertOrder({
      wooOrderId,
      billingEmail: "delivery-illegal@example.com",
      wooStatus: "processing",
      rawPayload: {},
      lineItems: [{ wooLineItemId: 1, quantity: 1, config: buildConfig() }],
    });
    const compositionId = await createComposition();

    await expect(
      repository.recordDelivery(quizzes[0].id, { compositionId, downloadToken: "tok-delivery-illegal" }),
    ).rejects.toThrow(IllegalQuizTransitionError);
  });
});

describe("clearDownloadToken", () => {
  it("clears the download token without changing status", async () => {
    const wooOrderId = freshWooOrderId();
    const { quizzes } = await repository.upsertOrder({
      wooOrderId,
      billingEmail: "prune@example.com",
      wooStatus: "processing",
      rawPayload: {},
      lineItems: [{ wooLineItemId: 1, quantity: 1, config: buildConfig() }],
    });
    const quizId = quizzes[0].id;
    await repository.transitionQuizStatus(quizId, "generating");
    const compositionId = await createComposition();
    await repository.recordDelivery(quizId, { compositionId, downloadToken: "tok-prune-1" });

    await repository.clearDownloadToken(quizId);

    const cleared = await repository.getQuizById(quizId);
    expect(cleared?.downloadToken).toBeNull();
    expect(cleared?.status).toBe("delivered");
  });
});

describe("listQuizzesByBillingEmail", () => {
  it("lists newest first and normalises the lookup email", async () => {
    const email = "history@example.com";
    const firstOrder = freshWooOrderId();
    await repository.upsertOrder({
      wooOrderId: firstOrder,
      billingEmail: email,
      wooStatus: "processing",
      rawPayload: {},
      lineItems: [{ wooLineItemId: 1, quantity: 1, config: buildConfig() }],
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const secondOrder = freshWooOrderId();
    const { quizzes: secondQuizzes } = await repository.upsertOrder({
      wooOrderId: secondOrder,
      billingEmail: email,
      wooStatus: "processing",
      rawPayload: {},
      lineItems: [{ wooLineItemId: 1, quantity: 1, config: buildConfig() }],
    });

    const result = await repository.listQuizzesByBillingEmail("  HISTORY@EXAMPLE.COM  ");

    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].id).toBe(secondQuizzes[0].id);
  });

  it("does not leak another billing email's Quizzes", async () => {
    const wooOrderId = freshWooOrderId();
    await repository.upsertOrder({
      wooOrderId,
      billingEmail: "owner-a@example.com",
      wooStatus: "processing",
      rawPayload: {},
      lineItems: [{ wooLineItemId: 1, quantity: 1, config: buildConfig() }],
    });

    const result = await repository.listQuizzesByBillingEmail("owner-b@example.com");

    expect(result).toEqual([]);
  });
});

describe("listQuizzesDeliveredBefore", () => {
  it("lists delivered Quizzes with a token whose deliveredAt is before the cutoff", async () => {
    const wooOrderId = freshWooOrderId();
    const { quizzes } = await repository.upsertOrder({
      wooOrderId,
      billingEmail: "prune-sweep@example.com",
      wooStatus: "processing",
      rawPayload: {},
      lineItems: [{ wooLineItemId: 1, quantity: 1, config: buildConfig() }],
    });
    const quizId = quizzes[0].id;
    await repository.transitionQuizStatus(quizId, "generating");
    const compositionId = await createComposition();
    await repository.recordDelivery(quizId, { compositionId, downloadToken: "tok-sweep-1" });

    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);

    const dueForPruning = await repository.listQuizzesDeliveredBefore(future);
    const notYetDue = await repository.listQuizzesDeliveredBefore(past);

    expect(dueForPruning.some((q) => q.id === quizId)).toBe(true);
    expect(notYetDue.some((q) => q.id === quizId)).toBe(false);
  });

  it("excludes delivered Quizzes whose token was already cleared", async () => {
    const wooOrderId = freshWooOrderId();
    const { quizzes } = await repository.upsertOrder({
      wooOrderId,
      billingEmail: "prune-sweep-cleared@example.com",
      wooStatus: "processing",
      rawPayload: {},
      lineItems: [{ wooLineItemId: 1, quantity: 1, config: buildConfig() }],
    });
    const quizId = quizzes[0].id;
    await repository.transitionQuizStatus(quizId, "generating");
    const compositionId = await createComposition();
    await repository.recordDelivery(quizId, { compositionId, downloadToken: "tok-sweep-cleared-1" });
    await repository.clearDownloadToken(quizId);

    const future = new Date(Date.now() + 60_000);
    const result = await repository.listQuizzesDeliveredBefore(future);

    expect(result.some((q) => q.id === quizId)).toBe(false);
  });
});

describe("getQuizById / getQuizByDownloadToken", () => {
  it("returns the Quiz by id, and null for an unknown id", async () => {
    const wooOrderId = freshWooOrderId();
    const { quizzes } = await repository.upsertOrder({
      wooOrderId,
      billingEmail: "get-by-id@example.com",
      wooStatus: "processing",
      rawPayload: {},
      lineItems: [{ wooLineItemId: 1, quantity: 1, config: buildConfig() }],
    });

    const found = await repository.getQuizById(quizzes[0].id);
    const notFound = await repository.getQuizById("00000000-0000-0000-0000-000000000000");

    expect(found?.id).toBe(quizzes[0].id);
    expect(notFound).toBeNull();
  });

  it("returns the Quiz by download token, and null for an unknown token", async () => {
    const wooOrderId = freshWooOrderId();
    const { quizzes } = await repository.upsertOrder({
      wooOrderId,
      billingEmail: "get-by-token@example.com",
      wooStatus: "processing",
      rawPayload: {},
      lineItems: [{ wooLineItemId: 1, quantity: 1, config: buildConfig() }],
    });
    const quizId = quizzes[0].id;
    await repository.transitionQuizStatus(quizId, "generating");
    const compositionId = await createComposition();
    await repository.recordDelivery(quizId, { compositionId, downloadToken: "tok-lookup-1" });

    const found = await repository.getQuizByDownloadToken("tok-lookup-1");
    const notFound = await repository.getQuizByDownloadToken("does-not-exist");

    expect(found?.id).toBe(quizId);
    expect(notFound).toBeNull();
  });
});

describe("listPendingQuizzes", () => {
  it("lists only pending Quizzes, for the worker's startup sweep", async () => {
    const wooOrderId = freshWooOrderId();
    const { quizzes } = await repository.upsertOrder({
      wooOrderId,
      billingEmail: "sweep@example.com",
      wooStatus: "processing",
      rawPayload: {},
      lineItems: [{ wooLineItemId: 1, quantity: 2, config: buildConfig() }],
    });
    await repository.transitionQuizStatus(quizzes[0].id, "generating");

    const pending = await repository.listPendingQuizzes();

    expect(pending.some((q) => q.id === quizzes[0].id)).toBe(false);
    expect(pending.some((q) => q.id === quizzes[1].id)).toBe(true);
  });
});

describe("order deletion is blocked while Quizzes reference it", () => {
  it("fails to delete an order that still has Quiz rows", async () => {
    const wooOrderId = freshWooOrderId();
    const { order } = await repository.upsertOrder({
      wooOrderId,
      billingEmail: "delete-blocked@example.com",
      wooStatus: "processing",
      rawPayload: {},
      lineItems: [{ wooLineItemId: 1, quantity: 1, config: buildConfig() }],
    });

    const { error } = await db.from("orders").delete().eq("id", order.id);

    expect(error).not.toBeNull();
  });
});

describe("deleting a Quiz never affects its Composition", () => {
  it("leaves the Composition row intact after the referencing Quiz is deleted", async () => {
    const wooOrderId = freshWooOrderId();
    const { quizzes } = await repository.upsertOrder({
      wooOrderId,
      billingEmail: "composition-unaffected@example.com",
      wooStatus: "processing",
      rawPayload: {},
      lineItems: [{ wooLineItemId: 1, quantity: 1, config: buildConfig() }],
    });
    const quizId = quizzes[0].id;
    await repository.transitionQuizStatus(quizId, "generating");
    const compositionId = await createComposition();
    await repository.recordDelivery(quizId, { compositionId, downloadToken: "tok-composition-unaffected-1" });

    const { error: deleteError } = await db.from("quizzes").delete().eq("id", quizId);
    if (deleteError) throw deleteError;

    const { data, error } = await db.from("compositions").select("id").eq("id", compositionId).maybeSingle();
    if (error) throw error;
    expect(data?.id).toBe(compositionId);
  });
});
