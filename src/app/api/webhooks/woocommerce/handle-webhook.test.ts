import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { OrderRecord, QuizRecord } from "@/domain";
import type { OrderLineItem, UpsertOrderInput } from "@/repository";
import { QuizStatusChangedConcurrentlyError } from "@/repository";
import { handleWebhook, type WebhookDeps } from "./handle-webhook";

const SECRET = "test-secret";
const FIXTURE_PATH = join(process.cwd(), "shop/fixtures/order-updated-processing.json");
const EXISTING_CATEGORY_IDS = new Set(["1", "2", "3", "4", "5", "6", "7", "8"]);

function loadFixtureBody(): Record<string, unknown> {
  const captured = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as { body: unknown };
  return captured.body as Record<string, unknown>;
}

function sign(body: string, secret: string = SECRET): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

function buildOrderRecord(): OrderRecord {
  return {
    id: "order-1",
    wooOrderId: 14,
    billingEmail: "fixture-buyer@example.com",
    wooStatus: "processing",
    createdAt: new Date().toISOString(),
  };
}

function buildQuizRecord(overrides: Partial<QuizRecord> = {}): QuizRecord {
  return {
    id: "quiz-1",
    orderId: "order-1",
    wooLineItemId: 4,
    sequence: 0,
    config: {
      locale: "nl",
      requestedDifficulty: "mixed",
      categoryPicks: ["1", "3", "5"],
    },
    status: "pending",
    failureReason: null,
    compositionId: null,
    downloadToken: null,
    deliveredAt: null,
    prunedAt: null,
    ...overrides,
  };
}

interface FakeOrderRepository {
  upsertOrder: ReturnType<typeof vi.fn>;
  transitionQuizStatus: ReturnType<typeof vi.fn>;
  getQuizById: ReturnType<typeof vi.fn>;
}

interface TestDeps {
  secret: string;
  orderRepository: FakeOrderRepository;
  loadCategoryIds: ReturnType<typeof vi.fn>;
  enqueueQuizJob: ReturnType<typeof vi.fn>;
  noteFailure: ReturnType<typeof vi.fn>;
}

function buildDeps(overrides: Partial<TestDeps> = {}): TestDeps {
  const orderRepository: FakeOrderRepository = {
    upsertOrder: vi.fn(async (input: UpsertOrderInput) => ({
      order: buildOrderRecord(),
      quizzes: input.lineItems.flatMap((lineItem: OrderLineItem) =>
        Array.from({ length: lineItem.quantity }, (_, sequence) =>
          buildQuizRecord({
            id: `quiz-${lineItem.wooLineItemId}-${sequence}`,
            wooLineItemId: lineItem.wooLineItemId,
            sequence,
            config: lineItem.config,
          }),
        ),
      ),
    })),
    transitionQuizStatus: vi.fn(async (quizId: string, to: string, options?: { failureReason?: string }) =>
      buildQuizRecord({ id: quizId, status: to as QuizRecord["status"], failureReason: options?.failureReason ?? null }),
    ),
    getQuizById: vi.fn(async (quizId: string) => buildQuizRecord({ id: quizId })),
  };

  const enqueueQuizJob = vi.fn(async () => {});
  const loadCategoryIds = vi.fn(async () => EXISTING_CATEGORY_IDS);
  const noteFailure = vi.fn(async () => {});

  return {
    secret: SECRET,
    orderRepository,
    loadCategoryIds,
    enqueueQuizJob,
    noteFailure,
    ...overrides,
  };
}

function toWebhookDeps(deps: TestDeps): WebhookDeps {
  return deps as unknown as WebhookDeps;
}

describe("handleWebhook", () => {
  it("200s and persists nothing for a wrong signature", async () => {
    const body = loadFixtureBody();
    const rawBody = JSON.stringify(body);
    const deps = buildDeps();

    const result = await handleWebhook(rawBody, sign(rawBody, "wrong-secret"), toWebhookDeps(deps));

    expect(result.status).toBe(401);
    expect(deps.orderRepository.upsertOrder).not.toHaveBeenCalled();
    expect(deps.enqueueQuizJob).not.toHaveBeenCalled();
  });

  it("401s and persists nothing for a missing signature", async () => {
    const body = loadFixtureBody();
    const rawBody = JSON.stringify(body);
    const deps = buildDeps();

    const result = await handleWebhook(rawBody, null, toWebhookDeps(deps));

    expect(result.status).toBe(401);
    expect(deps.orderRepository.upsertOrder).not.toHaveBeenCalled();
  });

  it("200s and persists nothing when the order status is not processing", async () => {
    const body = { ...loadFixtureBody(), status: "on-hold" };
    const rawBody = JSON.stringify(body);
    const deps = buildDeps();

    const result = await handleWebhook(rawBody, sign(rawBody), toWebhookDeps(deps));

    expect(result.status).toBe(200);
    expect(deps.orderRepository.upsertOrder).not.toHaveBeenCalled();
    expect(deps.enqueueQuizJob).not.toHaveBeenCalled();
  });

  it("200s, upserts the order and enqueues one job per pending Quiz for a valid processing payload", async () => {
    const body = loadFixtureBody();
    const rawBody = JSON.stringify(body);
    const deps = buildDeps();

    const result = await handleWebhook(rawBody, sign(rawBody), toWebhookDeps(deps));

    expect(result.status).toBe(200);
    expect(deps.orderRepository.upsertOrder).toHaveBeenCalledTimes(1);
    expect(deps.orderRepository.transitionQuizStatus).not.toHaveBeenCalled();
    expect(deps.enqueueQuizJob).toHaveBeenCalledTimes(1);
    expect(deps.enqueueQuizJob).toHaveBeenCalledWith("quiz-4-0");
    expect(deps.noteFailure).not.toHaveBeenCalled();
  });

  it("fails a Quiz whose line item carries an unknown Category id, notes the failure, and does not enqueue it", async () => {
    const body = loadFixtureBody();
    const lineItems = JSON.parse(JSON.stringify(body.line_items)) as { meta_data: { key: string; value: unknown }[] }[];
    lineItems[0].meta_data = lineItems[0].meta_data.map((entry) =>
      entry.key === "pubquiz_category_1" ? { ...entry, value: "999" } : entry,
    );
    const badBody = { ...body, line_items: lineItems };
    const rawBody = JSON.stringify(badBody);
    const deps = buildDeps();

    const result = await handleWebhook(rawBody, sign(rawBody), toWebhookDeps(deps));

    expect(result.status).toBe(200);
    expect(deps.orderRepository.transitionQuizStatus).toHaveBeenCalledTimes(1);
    expect(deps.orderRepository.transitionQuizStatus).toHaveBeenCalledWith(
      "quiz-4-0",
      "failed",
      expect.objectContaining({ failureReason: expect.stringMatching(/unknown category id "999"/i) }),
    );
    expect(deps.enqueueQuizJob).not.toHaveBeenCalled();
    expect(deps.noteFailure).toHaveBeenCalledTimes(1);
    expect(deps.noteFailure).toHaveBeenCalledWith({
      quizId: "quiz-4-0",
      reason: expect.stringMatching(/unknown category id "999"/i),
    });
  });

  it("still returns 200 and leaves the Quiz failed when noteFailure throws", async () => {
    const body = loadFixtureBody();
    const lineItems = JSON.parse(JSON.stringify(body.line_items)) as { meta_data: { key: string; value: unknown }[] }[];
    lineItems[0].meta_data = lineItems[0].meta_data.map((entry) =>
      entry.key === "pubquiz_category_1" ? { ...entry, value: "999" } : entry,
    );
    const rawBody = JSON.stringify({ ...body, line_items: lineItems });
    const deps = buildDeps({ noteFailure: vi.fn(async () => { throw new Error("shop unreachable"); }) });

    const result = await handleWebhook(rawBody, sign(rawBody), toWebhookDeps(deps));

    expect(result.status).toBe(200);
    expect(deps.orderRepository.transitionQuizStatus).toHaveBeenCalledTimes(1);
    expect(deps.orderRepository.transitionQuizStatus).toHaveBeenCalledWith(
      "quiz-4-0",
      "failed",
      expect.objectContaining({ failureReason: expect.stringMatching(/unknown category id "999"/i) }),
    );
  });

  it("skips re-transitioning and re-noting a Quiz another writer already settled during a lost race", async () => {
    const body = loadFixtureBody();
    const lineItems = JSON.parse(JSON.stringify(body.line_items)) as { meta_data: { key: string; value: unknown }[] }[];
    lineItems[0].meta_data = lineItems[0].meta_data.map((entry) =>
      entry.key === "pubquiz_category_1" ? { ...entry, value: "999" } : entry,
    );
    const rawBody = JSON.stringify({ ...body, line_items: lineItems });
    const deps = buildDeps();
    deps.orderRepository.transitionQuizStatus.mockRejectedValueOnce(
      new QuizStatusChangedConcurrentlyError("quiz-4-0", "pending"),
    );
    deps.orderRepository.getQuizById.mockResolvedValueOnce(buildQuizRecord({ id: "quiz-4-0", status: "failed" }));

    const result = await handleWebhook(rawBody, sign(rawBody), toWebhookDeps(deps));

    expect(result.status).toBe(200);
    expect(deps.orderRepository.transitionQuizStatus).toHaveBeenCalledTimes(1);
    expect(deps.noteFailure).not.toHaveBeenCalled();
  });

  it("retries the transition once after a lost race against a still-live Quiz, then notes the failure", async () => {
    const body = loadFixtureBody();
    const lineItems = JSON.parse(JSON.stringify(body.line_items)) as { meta_data: { key: string; value: unknown }[] }[];
    lineItems[0].meta_data = lineItems[0].meta_data.map((entry) =>
      entry.key === "pubquiz_category_1" ? { ...entry, value: "999" } : entry,
    );
    const rawBody = JSON.stringify({ ...body, line_items: lineItems });
    const deps = buildDeps();
    deps.orderRepository.transitionQuizStatus.mockRejectedValueOnce(
      new QuizStatusChangedConcurrentlyError("quiz-4-0", "pending"),
    );
    deps.orderRepository.getQuizById.mockResolvedValueOnce(buildQuizRecord({ id: "quiz-4-0", status: "pending" }));

    const result = await handleWebhook(rawBody, sign(rawBody), toWebhookDeps(deps));

    expect(result.status).toBe(200);
    expect(deps.orderRepository.transitionQuizStatus).toHaveBeenCalledTimes(2);
    expect(deps.noteFailure).toHaveBeenCalledTimes(1);
  });

  it("enqueues one job per unit for a line item with quantity n", async () => {
    const body = loadFixtureBody();
    const lineItems = JSON.parse(JSON.stringify(body.line_items)) as Record<string, unknown>[];
    lineItems[0] = { ...lineItems[0], quantity: 3 };
    const rawBody = JSON.stringify({ ...body, line_items: lineItems });
    const deps = buildDeps();

    const result = await handleWebhook(rawBody, sign(rawBody), toWebhookDeps(deps));

    expect(result.status).toBe(200);
    expect(deps.enqueueQuizJob).toHaveBeenCalledTimes(3);
    expect(deps.enqueueQuizJob).toHaveBeenCalledWith("quiz-4-0");
    expect(deps.enqueueQuizJob).toHaveBeenCalledWith("quiz-4-1");
    expect(deps.enqueueQuizJob).toHaveBeenCalledWith("quiz-4-2");
  });

  it("does not re-transition or re-enqueue a Quiz that already left pending on redelivery", async () => {
    const body = loadFixtureBody();
    const rawBody = JSON.stringify(body);
    const deps = buildDeps();
    deps.orderRepository.upsertOrder.mockResolvedValueOnce({
      order: buildOrderRecord(),
      quizzes: [buildQuizRecord({ id: "quiz-4-0", status: "generating" })],
    });

    const result = await handleWebhook(rawBody, sign(rawBody), toWebhookDeps(deps));

    expect(result.status).toBe(200);
    expect(deps.orderRepository.transitionQuizStatus).not.toHaveBeenCalled();
    expect(deps.enqueueQuizJob).not.toHaveBeenCalled();
  });
});
