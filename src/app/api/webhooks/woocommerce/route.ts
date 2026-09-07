/**
 * WooCommerce webhook route (spec #36, ticket #39). URL is pinned:
 * `npm run shop:up` points the shop's `order.updated` webhook straight at
 * `/api/webhooks/woocommerce` (see .env.example, shop/README.md). Kept
 * thin: all the signature/parse/persist/enqueue decision logic lives in
 * handleWebhook (./handle-webhook.ts), driven directly by its own unit
 * tests with faked repository/pg-boss deps; this file only adapts
 * Request/Response and wires the real repository and a real pg-boss
 * connection. See README.md.
 *
 * MUST stay reachable without authentication: WooCommerce has no way to
 * carry a session/API key here, only the signature this route itself
 * verifies. If an auth proxy/middleware is added later (none exists yet --
 * no src/middleware.ts or src/proxy.ts), this path must be excluded from it.
 */
import { createDeliverer, createOrderLookup, resolveDelivererConfigFromEnv } from "@/deliver";
import { createCategoryIdLookup, createOrderRepository, resolveLocalStackConfig } from "@/repository";
import { QUIZ_QUEUE } from "@/worker/boss";
import { getBoss } from "./boss-client";
import { handleWebhook } from "./handle-webhook";

const config = resolveLocalStackConfig();
const orderRepository = createOrderRepository(config);
const loadCategoryIds = createCategoryIdLookup(config);

async function enqueueQuizJob(quizId: string): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUIZ_QUEUE, { quizId }, { singletonKey: quizId });
}

/**
 * Creates a fresh Deliverer only when a failure actually needs noting
 * (mirrors src/worker/index.ts's own lazy `createDeliverer` call): a
 * machine with no WOOCOMMERCE_* env vars configured can still receive and
 * persist happy-path webhooks, and only throws here, on the rare failed
 * line item, when resolveDelivererConfigFromEnv() finds them missing.
 */
async function noteFailure(input: { quizId: string; reason: string }): Promise<void> {
  const deliverer = createDeliverer(resolveDelivererConfigFromEnv(), createOrderLookup(orderRepository));
  await deliverer.noteFailure(input);
}

function statusToResponse(status: 200 | 400 | 401): Response {
  return new Response(null, { status });
}

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const signatureHeader = request.headers.get("x-wc-webhook-signature");

  const result = await handleWebhook(rawBody, signatureHeader, {
    secret: process.env.WOOCOMMERCE_WEBHOOK_SECRET ?? "test-secret",
    orderRepository,
    loadCategoryIds,
    enqueueQuizJob,
    noteFailure,
  });

  return statusToResponse(result.status);
}
