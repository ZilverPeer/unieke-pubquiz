/**
 * Unit tests for createDeliverer against an in-process HTTP stub standing in
 * for the WooCommerce REST API -- no real shop involved. See README.md for
 * the empirical check against the real local shop.
 */
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { downloadMetaKey, OPERATOR_NOTE_PREFIX } from "@/domain";
import { createDeliverer, type DelivererConfig } from "./index";
import { createOrderLookup, type OrderLookup } from "./order-lookup";
import type { OrderRepository } from "@/repository";
import type { OrderRecord, QuizRecord } from "@/domain";

interface WooMetaDatum {
  id: number;
  key: string;
  value: string;
}

interface WooLineItem {
  id: number;
  meta_data: WooMetaDatum[];
}

interface WooOrder {
  id: number;
  status: string;
  line_items: WooLineItem[];
}

interface RecordedRequest {
  method: string;
  path: string;
  authorization: string | undefined;
  body: unknown;
}

/** A tiny stateful stand-in for the WooCommerce REST API's orders endpoints. */
class WooCommerceStub {
  private nextMetaId = 1;
  readonly requests: RecordedRequest[] = [];
  private orders = new Map<number, WooOrder>();
  private notes: Array<{ orderId: number; note: string; customer_note: boolean }> = [];
  forceStatus: number | null = null;

  seedOrder(order: WooOrder): void {
    this.orders.set(order.id, order);
  }

  getNotes(): ReadonlyArray<{ orderId: number; note: string; customer_note: boolean }> {
    return this.notes;
  }

  handle(req: IncomingMessage, res: ServerResponse, body: unknown): void {
    const path = req.url ?? "";
    this.requests.push({ method: req.method ?? "", path, authorization: req.headers.authorization, body });

    if (this.forceStatus !== null) {
      res.writeHead(this.forceStatus, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "stub forced error" }));
      return;
    }

    const orderMatch = path.match(/^\/wp-json\/wc\/v3\/orders\/(\d+)$/);
    const notesMatch = path.match(/^\/wp-json\/wc\/v3\/orders\/(\d+)\/notes$/);

    if (orderMatch && req.method === "GET") {
      const order = this.orders.get(Number(orderMatch[1]));
      if (!order) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "not found" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(order));
      return;
    }

    if (orderMatch && req.method === "PUT") {
      const orderId = Number(orderMatch[1]);
      const order = this.orders.get(orderId);
      if (!order) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "not found" }));
        return;
      }
      const update = body as { status?: string; line_items?: Array<{ id: number; meta_data: Array<{ id?: number; key: string; value: string }> }> };
      if (update.status) {
        order.status = update.status;
      }
      if (update.line_items) {
        for (const lineItemUpdate of update.line_items) {
          const lineItem = order.line_items.find((item) => item.id === lineItemUpdate.id);
          if (!lineItem) continue;
          for (const metaUpdate of lineItemUpdate.meta_data) {
            if (metaUpdate.id) {
              const existing = lineItem.meta_data.find((meta) => meta.id === metaUpdate.id);
              if (existing) existing.value = metaUpdate.value;
            } else {
              lineItem.meta_data.push({ id: this.nextMetaId++, key: metaUpdate.key, value: metaUpdate.value });
            }
          }
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(order));
      return;
    }

    if (notesMatch && req.method === "POST") {
      const orderId = Number(notesMatch[1]);
      const note = body as { note: string; customer_note: boolean };
      this.notes.push({ orderId, ...note });
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: this.notes.length, ...note }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "unhandled route in stub" }));
  }
}

function startServer(stub: WooCommerceStub): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw.length > 0 ? JSON.parse(raw) : undefined;
      stub.handle(req, res, body);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("expected an AddressInfo");
      resolve({ server, port: address.port });
    });
  });
}

function fakeQuiz(overrides: Partial<QuizRecord>): QuizRecord {
  return {
    id: "quiz-1",
    orderId: "order-1",
    wooLineItemId: 1,
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

function fakeOrderRecord(overrides: Partial<OrderRecord>): OrderRecord {
  return {
    id: "order-1",
    wooOrderId: 999,
    billingEmail: "a@b.com",
    wooStatus: "processing",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Builds an OrderLookup whose Quiz/order/sibling data is fully under test control. */
function fakeOrderLookup(quizzes: Map<string, QuizRecord>, order: OrderRecord): OrderLookup {
  const repository: Partial<OrderRepository> = {
    getQuizById: async (quizId) => quizzes.get(quizId) ?? null,
    getOrderById: async (orderId) => (orderId === order.id ? order : null),
    listQuizzesByOrderId: async (orderId) =>
      orderId === order.id ? Array.from(quizzes.values()).filter((quiz) => quiz.orderId === orderId) : [],
  };
  return createOrderLookup(repository as OrderRepository);
}

const CONSUMER_KEY = "ck_test";
const CONSUMER_SECRET = "cs_test";

describe("createDeliverer", () => {
  let stub: WooCommerceStub;
  let server: Server;
  let config: DelivererConfig;

  beforeEach(async () => {
    stub = new WooCommerceStub();
    const started = await startServer(stub);
    server = started.server;
    config = { baseUrl: `http://127.0.0.1:${started.port}`, consumerKey: CONSUMER_KEY, consumerSecret: CONSUMER_SECRET };
  });

  afterEach(() => {
    server.close();
  });

  test("attaches the four download URLs to the line item as meta_data via PUT", async () => {
    stub.seedOrder({ id: 999, status: "processing", line_items: [{ id: 1, meta_data: [] }] });
    const order = fakeOrderRecord({ wooOrderId: 999 });
    const quiz = fakeQuiz({ id: "quiz-1", wooLineItemId: 1, status: "delivered" });
    const lookup = fakeOrderLookup(new Map([["quiz-1", quiz]]), order);

    const deliverer = createDeliverer(config, lookup);
    await deliverer.deliverQuiz({
      quizId: "quiz-1",
      files: [
        { file: "quizmaster.pdf", url: "http://localhost:3000/download/tok/quizmaster.pdf" },
        { file: "picture-handout.pdf", url: "http://localhost:3000/download/tok/picture-handout.pdf" },
        { file: "answer-sheet.pdf", url: "http://localhost:3000/download/tok/answer-sheet.pdf" },
        { file: "music-round.mp3", url: "http://localhost:3000/download/tok/music-round.mp3" },
      ],
    });

    const putRequests = stub.requests.filter(
      (request) => request.method === "PUT" && (request.body as { line_items?: unknown }).line_items !== undefined,
    );
    expect(putRequests).toHaveLength(1);
    expect(putRequests[0].path).toBe("/wp-json/wc/v3/orders/999");
    expect(putRequests[0].authorization).toBe(
      `Basic ${Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString("base64")}`,
    );
    expect(putRequests[0].body).toEqual({
      line_items: [
        {
          id: 1,
          meta_data: [
            { key: downloadMetaKey("quizmaster.pdf"), value: "http://localhost:3000/download/tok/quizmaster.pdf" },
            {
              key: downloadMetaKey("picture-handout.pdf"),
              value: "http://localhost:3000/download/tok/picture-handout.pdf",
            },
            { key: downloadMetaKey("answer-sheet.pdf"), value: "http://localhost:3000/download/tok/answer-sheet.pdf" },
            { key: downloadMetaKey("music-round.mp3"), value: "http://localhost:3000/download/tok/music-round.mp3" },
          ],
        },
      ],
    });
  });

  test("does not complete the order for a single-Quiz-delivered order with a pending sibling", async () => {
    stub.seedOrder({
      id: 999,
      status: "processing",
      line_items: [
        { id: 1, meta_data: [] },
        { id: 2, meta_data: [] },
      ],
    });
    const order = fakeOrderRecord({ wooOrderId: 999 });
    const quizA = fakeQuiz({ id: "quiz-a", wooLineItemId: 1, status: "delivered" });
    const quizB = fakeQuiz({ id: "quiz-b", wooLineItemId: 2, status: "pending" });
    const lookup = fakeOrderLookup(
      new Map([
        ["quiz-a", quizA],
        ["quiz-b", quizB],
      ]),
      order,
    );

    const deliverer = createDeliverer(config, lookup);
    await deliverer.deliverQuiz({ quizId: "quiz-a", files: [] });

    const statusUpdates = stub.requests.filter(
      (request) => request.method === "PUT" && (request.body as { status?: string }).status !== undefined,
    );
    expect(statusUpdates).toHaveLength(0);
  });

  test("completes the order only once the second Quiz is also delivered", async () => {
    stub.seedOrder({
      id: 999,
      status: "processing",
      line_items: [
        { id: 1, meta_data: [] },
        { id: 2, meta_data: [] },
      ],
    });
    const order = fakeOrderRecord({ wooOrderId: 999 });
    const quizzes = new Map<string, QuizRecord>([
      ["quiz-a", fakeQuiz({ id: "quiz-a", wooLineItemId: 1, status: "delivered" })],
      ["quiz-b", fakeQuiz({ id: "quiz-b", wooLineItemId: 2, status: "pending" })],
    ]);
    const lookup = fakeOrderLookup(quizzes, order);
    const deliverer = createDeliverer(config, lookup);

    await deliverer.deliverQuiz({ quizId: "quiz-a", files: [] });
    expect(stub.requests.some((r) => r.method === "PUT" && (r.body as { status?: string }).status === "completed")).toBe(
      false,
    );

    // Second Quiz now also delivered.
    quizzes.set("quiz-b", fakeQuiz({ id: "quiz-b", wooLineItemId: 2, status: "delivered" }));
    await deliverer.deliverQuiz({ quizId: "quiz-b", files: [] });

    const completions = stub.requests.filter(
      (r) => r.method === "PUT" && (r.body as { status?: string }).status === "completed",
    );
    expect(completions).toHaveLength(1);
    expect(completions[0].path).toBe("/wp-json/wc/v3/orders/999");
  });

  test("a failed sibling prevents completion even after this Quiz delivers", async () => {
    stub.seedOrder({
      id: 999,
      status: "processing",
      line_items: [
        { id: 1, meta_data: [] },
        { id: 2, meta_data: [] },
      ],
    });
    const order = fakeOrderRecord({ wooOrderId: 999 });
    const quizzes = new Map<string, QuizRecord>([
      ["quiz-a", fakeQuiz({ id: "quiz-a", wooLineItemId: 1, status: "delivered" })],
      ["quiz-b", fakeQuiz({ id: "quiz-b", wooLineItemId: 2, status: "failed" })],
    ]);
    const lookup = fakeOrderLookup(quizzes, order);
    const deliverer = createDeliverer(config, lookup);

    await deliverer.deliverQuiz({ quizId: "quiz-a", files: [] });

    const completions = stub.requests.filter(
      (r) => r.method === "PUT" && (r.body as { status?: string }).status === "completed",
    );
    expect(completions).toHaveLength(0);
  });

  test("a second deliverQuiz call for the same Quiz does not duplicate meta_data or re-complete", async () => {
    stub.seedOrder({ id: 999, status: "processing", line_items: [{ id: 1, meta_data: [] }] });
    const order = fakeOrderRecord({ wooOrderId: 999 });
    const quiz = fakeQuiz({ id: "quiz-1", wooLineItemId: 1, status: "delivered" });
    const lookup = fakeOrderLookup(new Map([["quiz-1", quiz]]), order);
    const deliverer = createDeliverer(config, lookup);
    const files = [{ file: "quizmaster.pdf" as const, url: "http://localhost:3000/a" }];

    await deliverer.deliverQuiz({ quizId: "quiz-1", files });
    const completionsAfterFirst = stub.requests.filter(
      (r) => r.method === "PUT" && (r.body as { status?: string }).status === "completed",
    );
    expect(completionsAfterFirst).toHaveLength(1); // single Quiz, single-line order: completes on first delivery

    await deliverer.deliverQuiz({ quizId: "quiz-1", files });

    const finalOrder = await new Promise<WooOrder>((resolve) => {
      const req = httpRequest(
        { hostname: "127.0.0.1", port: new URL(config.baseUrl).port, path: "/wp-json/wc/v3/orders/999", method: "GET" },
        (res: IncomingMessage) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
        },
      );
      req.end();
    });
    expect(finalOrder.line_items[0].meta_data).toHaveLength(1);

    const completionsAfterSecond = stub.requests.filter(
      (r) => r.method === "PUT" && (r.body as { status?: string }).status === "completed",
    );
    expect(completionsAfterSecond).toHaveLength(1); // still just the one from the first call
  });

  test("noteFailure posts a private order note with the OPERATOR_NOTE_PREFIX and line item id", async () => {
    stub.seedOrder({ id: 999, status: "processing", line_items: [{ id: 1, meta_data: [] }] });
    const order = fakeOrderRecord({ wooOrderId: 999 });
    const quiz = fakeQuiz({ id: "quiz-1", wooLineItemId: 1, status: "failed" });
    const lookup = fakeOrderLookup(new Map([["quiz-1", quiz]]), order);
    const deliverer = createDeliverer(config, lookup);

    await deliverer.noteFailure({ quizId: "quiz-1", reason: "slot 2, Category X, shortfall 3" });

    expect(stub.getNotes()).toEqual([
      {
        orderId: 999,
        note: `${OPERATOR_NOTE_PREFIX} line item 1: slot 2, Category X, shortfall 3`,
        customer_note: false,
      },
    ]);
    const postRequest = stub.requests.find((r) => r.method === "POST");
    expect(postRequest?.path).toBe("/wp-json/wc/v3/orders/999/notes");

    const statusUpdates = stub.requests.filter(
      (r) => r.method === "PUT" && (r.body as { status?: string }).status !== undefined,
    );
    expect(statusUpdates).toHaveLength(0);
  });

  test("throws with status and endpoint on a non-2xx response", async () => {
    stub.seedOrder({ id: 999, status: "processing", line_items: [{ id: 1, meta_data: [] }] });
    stub.forceStatus = 500;
    const order = fakeOrderRecord({ wooOrderId: 999 });
    const quiz = fakeQuiz({ id: "quiz-1", wooLineItemId: 1, status: "delivered" });
    const lookup = fakeOrderLookup(new Map([["quiz-1", quiz]]), order);
    const deliverer = createDeliverer(config, lookup);

    await expect(deliverer.deliverQuiz({ quizId: "quiz-1", files: [] })).rejects.toThrow(/500/);
    await expect(deliverer.deliverQuiz({ quizId: "quiz-1", files: [] })).rejects.toThrow(/wc\/v3\/orders\/999/);
  });

  test("throws with the endpoint on a connection refusal", async () => {
    const order = fakeOrderRecord({ wooOrderId: 999 });
    const quiz = fakeQuiz({ id: "quiz-1", wooLineItemId: 1, status: "delivered" });
    const lookup = fakeOrderLookup(new Map([["quiz-1", quiz]]), order);
    // Close the server first so the port is refused.
    await new Promise<void>((resolve) => server.close(() => resolve()));

    const deliverer = createDeliverer(config, lookup);
    await expect(deliverer.deliverQuiz({ quizId: "quiz-1", files: [] })).rejects.toThrow(/wc\/v3\/orders\/999/);
  });
});
