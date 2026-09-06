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
import { beforeEach, describe, expect, it } from "vitest";
import type { CategoryPick, QuizConfig } from "@/domain";
import { DELIVERABLE_CONTENT_TYPES, DELIVERABLE_FILES } from "@/domain";
import type { Deliverer } from "@/deliver";
import {
  createDeliverableUploader,
  createOrderRepository,
  createRepository,
  resolveLocalStackConfig,
} from "@/repository";
import type { Database } from "@/repository/database.types";
import { resolveFfmpeg } from "@/render";
import { handleQuizJob, type QuizJobDeps, type QuizJobLike } from "@/worker/quiz-job";
import { GET } from "./route";

const config = resolveLocalStackConfig();
const orderRepository = createOrderRepository(config);
const contentRepository = createRepository(config);
const uploadDeliverable = createDeliverableUploader(config);

const db: SupabaseClient<Database> = createClient(config.url, config.serviceRoleKey);

let nextWooOrderId = 700_000;
function freshWooOrderId(): number {
  return nextWooOrderId++;
}

function freshEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`;
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

beforeEach(async () => {
  const { error: quizzesError } = await db.from("quizzes").delete().not("id", "is", null);
  if (quizzesError) throw quizzesError;
  const { error: ordersError } = await db.from("orders").delete().not("id", "is", null);
  if (ordersError) throw ordersError;
  const { error: compositionsError } = await db.from("compositions").delete().not("id", "is", null);
  if (compositionsError) throw compositionsError;
});

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

  it("410s once the token is known but the object has been pruned from the bucket", async () => {
    const { quizId, token } = await deliverFreshQuiz("route-410");

    // Simulates the pruning job's object deletion (ticket #42's prune.ts),
    // done directly here so this test only exercises the route's own
    // "object gone" branch, independent of prune.ts's own behaviour (see
    // src/worker/prune.integration.test.ts for that).
    const paths = DELIVERABLE_FILES.map((f) => `${quizId}/${f}`);
    const { error } = await db.storage.from("deliverables").remove(paths);
    if (error) throw error;

    const response = await GET(new Request("http://localhost/download/x"), paramsFor(token, "quizmaster.pdf"));

    expect(response.status).toBe(410);
  });
});
