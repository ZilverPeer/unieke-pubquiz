/**
 * Integration tests for the download route (ticket #42). Runs against the
 * real local Supabase stack -- see src/repository/README.md for the run
 * sequence. Builds a real delivered Quiz via handleQuizJob (nothing about
 * sample/render is mocked, only the Deliverer -- see
 * src/worker/quiz-job.integration.test.ts for the same convention), then
 * drives the route's exported GET directly (no need for a running Next
 * server).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";
import type { CategoryPick, QuizConfig } from "@/domain";
import { DELIVERABLE_CONTENT_TYPES, DELIVERABLE_FILES, DOWNLOAD_VALIDITY_DAYS } from "@/domain";
import type { Deliverer } from "@/deliver";
import {
  createDeliverableRemover,
  createDeliverableUploader,
  createOrderRepository,
  createRepository,
  resolveLocalStackConfig,
} from "@/repository";
import type { Database } from "@/repository/database.types";
import { resolveFfmpeg } from "@/render";
import { generateQuiz } from "@/scripts/generate-quiz";
import { createScopedCleanup } from "@/test-support/scoped-cleanup";
import { pruneDeliverables } from "@/worker/prune";
import { handleQuizJob, type QuizJobDeps, type QuizJobLike } from "@/worker/quiz-job";
import { GET } from "./route";

const config = resolveLocalStackConfig();
const orderRepository = createOrderRepository(config);
const contentRepository = createRepository(config);
const uploadDeliverable = createDeliverableUploader(config);
const removeDeliverables = createDeliverableRemover(config);

const db: SupabaseClient<Database> = createClient(config.url, config.serviceRoleKey);

// Scopes cleanup to exactly the billing emails this suite hands out via
// freshEmail(), so a real order or another suite's fixture on the same
// stack survives this run (ticket #51 -- see
// src/test-support/scoped-cleanup.ts).
const cleanup = createScopedCleanup(db);

afterEach(async () => {
  await cleanup.cleanup();
});

let nextWooOrderId = 700_000;
function freshWooOrderId(): number {
  return nextWooOrderId++;
}

function freshEmail(prefix: string): string {
  return cleanup.trackEmail(`${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`);
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

function buildDeps(): QuizJobDeps {
  return {
    orderRepository,
    contentRepository,
    uploadDeliverable,
    deliverer: noopDeliverer,
    generateQuiz,
    appBaseUrl: "http://localhost:3000",
  };
}

async function deliverFreshQuiz(prefix: string): Promise<{ quizId: string; token: string }> {
  const quizId = await insertPendingQuiz(freshEmail(prefix));
  const job: QuizJobLike = { data: { quizId }, retryCount: 0, retryLimit: 3 };
  await handleQuizJob(job, buildDeps());
  const quiz = await orderRepository.getQuizById(quizId);
  if (!quiz?.downloadToken) throw new Error("test setup failed: Quiz was not delivered");
  return { quizId, token: quiz.downloadToken };
}

function paramsFor(token: string, file: string): { params: Promise<{ token: string; file: string }> } {
  return { params: Promise.resolve({ token, file }) };
}

async function backdateDeliveredAt(quizId: string, daysAgo: number): Promise<void> {
  const deliveredAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const { error } = await db.from("quizzes").update({ delivered_at: deliveredAt.toISOString() }).eq("id", quizId);
  if (error) throw error;
}


describe.skipIf(resolveFfmpeg() === null)("GET /download/[token]/[file] (needs ffmpeg)", () => {
  it("404s a file name outside DELIVERABLE_FILES", async () => {
    const { token } = await deliverFreshQuiz("route-badfile");

    const response = await GET(new Request("http://localhost/download/x"), paramsFor(token, "not-a-file.pdf"));

    expect(response.status).toBe(404);
  });

  it("404s an unknown token", async () => {
    const response = await GET(
      new Request("http://localhost/download/x"),
      paramsFor("this-token-never-existed", "quizmaster.pdf"),
    );

    expect(response.status).toBe(404);
  });

  it.each(DELIVERABLE_FILES)("200s %s with the right headers and a non-empty body", async (file) => {
    const { token } = await deliverFreshQuiz(`route-200-${file}`);

    const response = await GET(new Request("http://localhost/download/x"), paramsFor(token, file));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(DELIVERABLE_CONTENT_TYPES[file]);
    expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="${file}"`);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body.length).toBeGreaterThan(0);
  });

  it("410s once the token is known but the Quiz has been pruned by the real pruning job", async () => {
    const { quizId, token } = await deliverFreshQuiz("route-410");
    await backdateDeliveredAt(quizId, DOWNLOAD_VALIDITY_DAYS + 1);

    // Goes through the real pruneDeliverables (src/worker/prune.ts) rather
    // than deleting objects directly: this is the HARD-finding regression
    // the coordinator flagged -- pruning must keep the token so this route
    // still recognises it and answers 410, not 404 (CONTEXT.md "Orders and
    // Quizzes").
    const pruneResult = await pruneDeliverables({ orderRepository, removeDeliverables }, new Date());
    expect(pruneResult.prunedQuizIds).toContain(quizId);

    const response = await GET(new Request("http://localhost/download/x"), paramsFor(token, "quizmaster.pdf"));

    expect(response.status).toBe(410);
  });
});
