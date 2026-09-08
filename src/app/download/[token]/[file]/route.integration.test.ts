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
import { DELIVERABLE_CONTENT_TYPES, DELIVERABLE_FILES, DOWNLOAD_VALIDITY_DAYS, quizZipFilename } from "@/domain";
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

async function insertPendingQuiz(billingEmail: string): Promise<{ quizId: string; wooOrderId: number }> {
  const wooOrderId = freshWooOrderId();
  const { quizzes } = await orderRepository.upsertOrder({
    wooOrderId,
    billingEmail,
    wooStatus: "processing",
    rawPayload: { id: wooOrderId },
    lineItems: [{ wooLineItemId: 1, quantity: 1, config: buildConfig() }],
  });
  return { quizId: quizzes[0].id, wooOrderId };
}

/**
 * Two distinct line items (two `--quiz` groups at checkout), each its own
 * Quiz at `quizzes.sequence` 0 -- reproduces the collision found empirically
 * against the running local loop (order #20, ticket #73): both Quizzes'
 * zip file names came out identical ("pubquiz-20-1-nl.zip" for both) when
 * the route used the per-line-item `sequence` directly instead of an
 * order-wide position (see DownloadQuizLookup's doc comment,
 * src/app/download/resolve-download.ts).
 */
async function insertPendingTwoQuizOrder(billingEmail: string): Promise<{ quizIds: string[]; wooOrderId: number }> {
  const wooOrderId = freshWooOrderId();
  const { quizzes } = await orderRepository.upsertOrder({
    wooOrderId,
    billingEmail,
    wooStatus: "processing",
    rawPayload: { id: wooOrderId },
    lineItems: [
      { wooLineItemId: 1, quantity: 1, config: buildConfig() },
      { wooLineItemId: 2, quantity: 1, config: buildConfig() },
    ],
  });
  return { quizIds: quizzes.map((quiz) => quiz.id), wooOrderId };
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

async function deliverFreshQuiz(prefix: string): Promise<{ quizId: string; token: string; wooOrderId: number }> {
  const { quizId, wooOrderId } = await insertPendingQuiz(freshEmail(prefix));
  const job: QuizJobLike = { data: { quizId }, retryCount: 0, retryLimit: 3 };
  await handleQuizJob(job, buildDeps());
  const quiz = await orderRepository.getQuizById(quizId);
  if (!quiz?.downloadToken) throw new Error("test setup failed: Quiz was not delivered");
  return { quizId, token: quiz.downloadToken, wooOrderId };
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
      paramsFor("this-token-never-existed", "quiz.zip"),
    );

    expect(response.status).toBe(404);
  });

  it.each(DELIVERABLE_FILES)("200s %s with the right headers and a non-empty body", async (file) => {
    const { token, wooOrderId } = await deliverFreshQuiz(`route-200-${file}`);

    const response = await GET(new Request("http://localhost/download/x"), paramsFor(token, file));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(DELIVERABLE_CONTENT_TYPES[file]);
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="${quizZipFilename(wooOrderId, 0, "nl")}"`,
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body.length).toBeGreaterThan(0);
  });

  it("gives two Quizzes on the same order (two line items) distinct zip file names", async () => {
    const { quizIds, wooOrderId } = await insertPendingTwoQuizOrder("route-two-quiz");
    for (const quizId of quizIds) {
      const job: QuizJobLike = { data: { quizId }, retryCount: 0, retryLimit: 3 };
      await handleQuizJob(job, buildDeps());
    }
    const tokens = await Promise.all(
      quizIds.map(async (quizId) => {
        const quiz = await orderRepository.getQuizById(quizId);
        if (!quiz?.downloadToken) throw new Error("test setup failed: Quiz was not delivered");
        return quiz.downloadToken;
      }),
    );

    const filenames = await Promise.all(
      tokens.map(async (token) => {
        const response = await GET(new Request("http://localhost/download/x"), paramsFor(token, "quiz.zip"));
        expect(response.status).toBe(200);
        return response.headers.get("Content-Disposition");
      }),
    );

    expect(new Set(filenames).size).toBe(filenames.length);
    expect(filenames.sort()).toEqual(
      [quizZipFilename(wooOrderId, 0, "nl"), quizZipFilename(wooOrderId, 1, "nl")]
        .map((filename) => `attachment; filename="${filename}"`)
        .sort(),
    );
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

    const response = await GET(new Request("http://localhost/download/x"), paramsFor(token, "quiz.zip"));

    expect(response.status).toBe(410);
  });
});
