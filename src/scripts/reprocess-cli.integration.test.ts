/**
 * Integration tests for `--retry-quiz`/`--composition` (ticket #42) driven
 * through the real CLI process (generate.ts), same convention as
 * generate.integration.test.ts's `runCli` -- proves the real argv path, real
 * pg-boss wiring, and (for `--composition`) the real, still-unimplemented
 * createDeliverer() (ticket #41) being caught and reported rather than
 * crashing the script. See recompose-quiz.integration.test.ts for
 * fake-Deliverer-injected coverage of recomposeQuiz's own rendering/upload
 * behaviour.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { PgBoss } from "pg-boss";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CategoryPick, QuizConfig } from "@/domain";
import { QUIZ_QUEUE, createQuizQueue, resolveDatabaseUrl } from "@/worker/boss";
import { handleQuizJob } from "@/worker/quiz-job";
import {
  createDeliverableUploader,
  createOrderRepository,
  createRepository,
  resolveLocalStackConfig,
} from "@/repository";
import type { Database } from "@/repository/database.types";
import { resolveFfmpeg } from "@/render";

const config = resolveLocalStackConfig();
const orderRepository = createOrderRepository(config);
const contentRepository = createRepository(config);
const uploadDeliverable = createDeliverableUploader(config);
const db: SupabaseClient<Database> = createClient(config.url, config.serviceRoleKey);

let nextWooOrderId = 950_000;
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

const REPO_ROOT = join(__dirname, "..", "..");

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", join(REPO_ROOT, "src", "scripts", "generate.ts"), ...args],
    {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      env: {
        ...process.env,
        SUPABASE_URL: config.url,
        SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey,
      },
    },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

beforeEach(async () => {
  const { error: quizzesError } = await db.from("quizzes").delete().not("id", "is", null);
  if (quizzesError) throw quizzesError;
  const { error: ordersError } = await db.from("orders").delete().not("id", "is", null);
  if (ordersError) throw ordersError;
  const { error: compositionsError } = await db.from("compositions").delete().not("id", "is", null);
  if (compositionsError) throw compositionsError;
});

describe("--retry-quiz CLI", () => {
  let boss: PgBoss;

  afterEach(async () => {
    if (boss) await boss.stop({ graceful: false });
  });

  it("moves a failed Quiz to pending and enqueues a job", async () => {
    const quizId = await insertPendingQuiz(freshEmail("retry-happy"));
    await orderRepository.transitionQuizStatus(quizId, "generating");
    await orderRepository.transitionQuizStatus(quizId, "failed", { failureReason: "test: simulated failure" });

    const { status, stdout, stderr } = runCli(["--retry-quiz", quizId]);
    expect(status, stderr).toBe(0);
    expect(stdout).toContain("pending");

    const quiz = await orderRepository.getQuizById(quizId);
    expect(quiz?.status).toBe("pending");

    // A job now exists for this Quiz id: a fresh send() with the same
    // singletonKey against the same queue returns null instead of creating
    // a second one (see src/worker/boss.ts / README.md).
    boss = new PgBoss(resolveDatabaseUrl());
    await boss.start();
    await createQuizQueue(boss);
    const duplicate = await boss.send(QUIZ_QUEUE, { quizId }, { singletonKey: quizId });
    expect(duplicate).toBeNull();
  });

  it("refuses a Quiz that isn't failed", async () => {
    const quizId = await insertPendingQuiz(freshEmail("retry-refuse"));

    const { status, stdout } = runCli(["--retry-quiz", quizId]);

    expect(status).toBe(1);
    expect(stdout).toContain("not \"failed\"");

    const quiz = await orderRepository.getQuizById(quizId);
    expect(quiz?.status).toBe("pending");
  });
});

describe.skipIf(resolveFfmpeg() === null)("--composition CLI (needs ffmpeg)", () => {
  it("uploads Deliverables and reports delivery is not implemented yet (ticket #41)", async () => {
    // generateQuiz + a real render pass, driven through the CLI's own
    // `generate` command first, to get a real Composition + Quiz pair with
    // a download token -- mirrors generate.integration.test.ts's own use of
    // the CLI as arrangement.
    const email = freshEmail("composition-cli");
    const quizId = await insertPendingQuiz(email);

    // The CLI's --composition flag needs an existing Quiz row referencing a
    // real Composition; build one the same way the worker would, reusing
    // handleQuizJob directly (nothing about sample/render is mocked -- only
    // the Deliverer, see quiz-job.integration.test.ts's own convention).
    await handleQuizJob(
      { data: { quizId }, retryCount: 0, retryLimit: 3 },
      {
        orderRepository,
        contentRepository,
        uploadDeliverable,
        deliverer: { deliverQuiz: async () => {}, noteFailure: async () => {} },
        appBaseUrl: "http://localhost:3000",
      },
    );
    const quiz = await orderRepository.getQuizById(quizId);
    if (!quiz?.compositionId) throw new Error("test setup failed: Quiz was not delivered");

    const { status, stdout, stderr } = runCli(["--composition", quiz.compositionId]);

    expect(status, stderr).toBe(0);
    expect(stdout).toContain("delivery is not implemented yet");
  });
});
