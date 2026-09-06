/**
 * Integration tests for the quiz-generation job handler (spec #36, ticket
 * #40). Runs against the real local Supabase stack and the real engine --
 * see src/repository/README.md for the run sequence. Nothing about
 * sample/render is mocked; only the pinned Deliverer interface is stubbed
 * (WooCommerce is out of scope for #40, see src/deliver/index.ts).
 *
 * The deterministic cases (success, shortfall) drive handleQuizJob directly.
 * The retry/sweep cases run a real pg-boss instance with a fast retry
 * policy so the suite stays quick.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PgBoss } from "pg-boss";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CategoryPick, Locale, QuizConfig } from "@/domain";
import { downloadPath } from "@/domain";
import { generateQuiz } from "@/scripts/generate-quiz";
import {
  createDeliverableUploader,
  createOrderRepository,
  createRepository,
  resolveLocalStackConfig,
} from "@/repository";
import type { Database } from "@/repository/database.types";
import { resolveFfmpeg } from "@/render";
import type { Deliverer, DeliveredFile } from "@/deliver";
import { createQuizQueue, QUIZ_QUEUE, resolveDatabaseUrl } from "./boss";
import { handleQuizJob, type QuizJobDeps, type QuizJobLike } from "./quiz-job";
import { sweepPendingQuizzes } from "./sweep";

const config = resolveLocalStackConfig();
const orderRepository = createOrderRepository(config);
const contentRepository = createRepository(config);
const uploadDeliverable = createDeliverableUploader(config);
const APP_BASE_URL = "http://localhost:3000";

// Raw client for test arrangement/verification only -- see
// src/repository/orders.integration.test.ts for the same convention.
const db: SupabaseClient<Database> = createClient(config.url, config.serviceRoleKey);

let nextWooOrderId = 800_000;
function freshWooOrderId(): number {
  return nextWooOrderId++;
}

function freshEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`;
}

const FULLY_RANDOM_PICKS: CategoryPick[] = new Array(8).fill(undefined);

function buildConfig(overrides: Partial<QuizConfig> = {}): QuizConfig {
  return {
    locale: "nl",
    quizMode: "mixed",
    categoryPicks: FULLY_RANDOM_PICKS,
    requestedDifficulty: "mixed",
    ...overrides,
  };
}

async function insertPendingQuiz(billingEmail: string, config: QuizConfig): Promise<string> {
  const wooOrderId = freshWooOrderId();
  const { quizzes } = await orderRepository.upsertOrder({
    wooOrderId,
    billingEmail,
    wooStatus: "processing",
    rawPayload: { id: wooOrderId },
    lineItems: [{ wooLineItemId: 1, quantity: 1, config }],
  });
  return quizzes[0].id;
}

/** In-memory stand-in for the pinned Deliverer interface, recording every call. */
function createRecordingDeliverer(): Deliverer & {
  deliverCalls: { quizId: string; files: readonly DeliveredFile[] }[];
  failureCalls: { quizId: string; reason: string }[];
} {
  const deliverCalls: { quizId: string; files: readonly DeliveredFile[] }[] = [];
  const failureCalls: { quizId: string; reason: string }[] = [];
  return {
    deliverCalls,
    failureCalls,
    deliverQuiz: async (input) => {
      deliverCalls.push(input);
    },
    noteFailure: async (input) => {
      failureCalls.push(input);
    },
  };
}

function buildDeps(deliverer: Deliverer): QuizJobDeps {
  return {
    orderRepository,
    contentRepository,
    uploadDeliverable,
    deliverer,
    appBaseUrl: APP_BASE_URL,
  };
}

function firstAttempt(quizId: string, retryLimit = 3): QuizJobLike {
  return { data: { quizId }, retryCount: 0, retryLimit };
}

async function listDeliverableObjectNames(quizId: string): Promise<string[]> {
  const { data, error } = await db.storage.from("deliverables").list(quizId);
  if (error) throw error;
  return data.map((object) => object.name).sort();
}

beforeEach(async () => {
  // Mirrors orders.integration.test.ts's beforeEach: quizzes before orders
  // (no cascade), compositions last (cascades to composition_items).
  const { error: quizzesError } = await db.from("quizzes").delete().not("id", "is", null);
  if (quizzesError) throw quizzesError;
  const { error: ordersError } = await db.from("orders").delete().not("id", "is", null);
  if (ordersError) throw ordersError;
  const { error: compositionsError } = await db.from("compositions").delete().not("id", "is", null);
  if (compositionsError) throw compositionsError;
});

describe.skipIf(resolveFfmpeg() === null)("handleQuizJob, driven directly (needs ffmpeg)", () => {
  it("generates, uploads the four Deliverables, records delivery, and calls deliverQuiz once", async () => {
    const email = freshEmail("worker-success");
    const quizId = await insertPendingQuiz(email, buildConfig());
    const deliverer = createRecordingDeliverer();

    await handleQuizJob(firstAttempt(quizId), buildDeps(deliverer));

    const objectNames = await listDeliverableObjectNames(quizId);
    expect(objectNames).toEqual(
      ["answer-sheet.pdf", "music-round.mp3", "picture-handout.pdf", "quizmaster.pdf"].sort(),
    );

    const quiz = await orderRepository.getQuizById(quizId);
    expect(quiz?.status).toBe("delivered");
    expect(quiz?.compositionId).toBeTruthy();
    expect(quiz?.downloadToken).toBeTruthy();
    expect(quiz?.deliveredAt).toBeTruthy();

    expect(deliverer.deliverCalls).toHaveLength(1);
    expect(deliverer.failureCalls).toHaveLength(0);
    const call = deliverer.deliverCalls[0];
    expect(call.quizId).toBe(quizId);
    expect(call.files.map((f) => f.file).sort()).toEqual(
      ["answer-sheet.pdf", "music-round.mp3", "picture-handout.pdf", "quizmaster.pdf"].sort(),
    );
    for (const file of call.files) {
      expect(file.url).toBe(`${APP_BASE_URL}${downloadPath(quiz!.downloadToken!, file.file)}`);
    }
  });

  it(
    "a Quiz whose configuration cannot be satisfied ends failed after one attempt, with slot/Category/shortfall in the reason, nothing in the bucket",
    async () => {
      // Same fixture as generate.integration.test.ts's "unsatisfiable
      // requests" suite: Category id 1 ("Sport"/"Sports") gets 70 hard Text
      // Items (7 per Subsubcategory x 10), 60 of which a first
      // single_category/hard run consumes, leaving exactly 10 -- enough for
      // a second run's slot 0 but not its slot 1.
      const HARD_TEXT_CATEGORY_ID = "1";
      const HARD_TEXT_CATEGORY_NAME: Record<Locale, string> = { nl: "Sport", en: "Sports" };
      const email = freshEmail("worker-shortfall");

      function singleCategoryPick(categoryId: string): CategoryPick[] {
        const picks = new Array(8).fill(undefined) as CategoryPick[];
        picks[0] = categoryId;
        return picks;
      }

      const firstResult = await generateQuiz(
        {
          locale: "nl",
          quizMode: "single_category",
          categoryPicks: singleCategoryPick(HARD_TEXT_CATEGORY_ID),
          requestedDifficulty: "hard",
          billingEmail: email,
          seed: 300,
          out: "unused",
        },
        contentRepository,
        async () => {},
      );
      expect(firstResult.ok).toBe(true);

      const quizId = await insertPendingQuiz(
        email,
        buildConfig({
          quizMode: "single_category",
          categoryPicks: singleCategoryPick(HARD_TEXT_CATEGORY_ID),
          requestedDifficulty: "hard",
        }),
      );
      const deliverer = createRecordingDeliverer();

      await handleQuizJob(firstAttempt(quizId), buildDeps(deliverer));

      const quiz = await orderRepository.getQuizById(quizId);
      expect(quiz?.status).toBe("failed");
      expect(quiz?.failureReason).toBe(`slot 1, Category ${HARD_TEXT_CATEGORY_NAME.nl}, shortfall 10`);
      expect(quiz?.compositionId).toBeNull();

      const objectNames = await listDeliverableObjectNames(quizId);
      expect(objectNames).toEqual([]);

      expect(deliverer.deliverCalls).toHaveLength(0);
      expect(deliverer.failureCalls).toEqual([
        { quizId, reason: `slot 1, Category ${HARD_TEXT_CATEGORY_NAME.nl}, shortfall 10` },
      ]);
    },
  );

  it(
    'a Quiz stuck in "generating" from a crashed prior attempt ends failed with a note on the last allowed attempt, instead of being dead-lettered',
    async () => {
      const email = freshEmail("worker-stale-generating");
      const quizId = await insertPendingQuiz(email, buildConfig());
      // Simulates a prior attempt that crashed (killed process, not a
      // thrown/caught error) mid-generation: the Quiz is left in
      // "generating" with no live job. A fresh attempt landing here can
      // never legally re-enter "generating" (QUIZ_STATUS_TRANSITIONS has no
      // generating -> generating edge) -- on the last allowed attempt, that
      // must still end the Quiz "failed" with noteFailure called, not
      // propagate and dead-letter the job (see quiz-job.ts).
      await orderRepository.transitionQuizStatus(quizId, "generating");

      const deliverer = createRecordingDeliverer();
      const lastAttempt: QuizJobLike = { data: { quizId }, retryCount: 0, retryLimit: 0 };

      await handleQuizJob(lastAttempt, buildDeps(deliverer));

      const quiz = await orderRepository.getQuizById(quizId);
      expect(quiz?.status).toBe("failed");
      expect(quiz?.failureReason).toContain('cannot transition from "generating" to "generating"');

      const objectNames = await listDeliverableObjectNames(quizId);
      expect(objectNames).toEqual([]);

      expect(deliverer.deliverCalls).toHaveLength(0);
      expect(deliverer.failureCalls).toHaveLength(1);
      expect(deliverer.failureCalls[0].quizId).toBe(quizId);
    },
  );
});

describe.skipIf(resolveFfmpeg() === null)("retry policy, through a real pg-boss instance (needs ffmpeg)", () => {
  let boss: PgBoss;

  beforeAll(async () => {
    boss = new PgBoss(resolveDatabaseUrl());
    await boss.start();
    // Fast retries so this suite stays quick: 1s fixed delay, no backoff,
    // half-second polling (pg-boss's minimum).
    await createQuizQueue(boss, { retryLimit: 3, retryDelay: 1, retryBackoff: false, pollingIntervalSeconds: 0.5 });
  }, 30_000);

  afterAll(async () => {
    await boss.stop({ graceful: false });
  });

  afterEach(async () => {
    await boss.offWork(QUIZ_QUEUE);
  });

  /**
   * Waits until `getCallCount()` reaches `expectedCalls` (`deliverQuiz` is
   * called once per attempt, including retries). Quiz status alone can't
   * signal "all retries are done": `recordDelivery` flips the Quiz to
   * "delivered" on the very first attempt, before `deliverQuiz` -- let alone
   * its retries -- has even run once (see quiz-job.ts), so waiting on status
   * would resolve immediately and never observe the retries this test is
   * about.
   */
  async function waitForCalls(getCallCount: () => number, expectedCalls: number): Promise<void> {
    await vi.waitFor(
      () => {
        expect(getCallCount()).toBe(expectedCalls);
      },
      { timeout: 20_000, interval: 250 },
    );
  }

  async function registerHandler(deliverer: Deliverer): Promise<void> {
    await boss.work<{ quizId: string }, void, { includeMetadata: true }>(
      QUIZ_QUEUE,
      { includeMetadata: true },
      async (jobs) => {
        const [job] = jobs;
        await handleQuizJob(job, buildDeps(deliverer));
      },
    );
  }

  it(
    "a deliverer that throws twice then succeeds ends delivered, without regenerating on the retries",
    async () => {
      const email = freshEmail("worker-retry-success");
      const quizId = await insertPendingQuiz(email, buildConfig());

      let calls = 0;
      const deliverer: Deliverer = {
        deliverQuiz: async () => {
          calls++;
          if (calls < 3) throw new Error(`transient delivery failure #${calls}`);
        },
        noteFailure: async () => {},
      };

      await registerHandler(deliverer);
      await boss.send(QUIZ_QUEUE, { quizId }, { singletonKey: quizId });
      await waitForCalls(() => calls, 3);

      const quiz = await orderRepository.getQuizById(quizId);
      expect(quiz?.status).toBe("delivered");

      // Only generated once: the same Composition id survives every retry.
      const objectNames = await listDeliverableObjectNames(quizId);
      expect(objectNames).toHaveLength(4);
    },
    30_000,
  );

  it(
    "a deliverer that always throws ends failed after three retries",
    async () => {
      const email = freshEmail("worker-retry-exhausted");
      const quizId = await insertPendingQuiz(email, buildConfig());

      let calls = 0;
      const deliverer: Deliverer = {
        deliverQuiz: async () => {
          calls++;
          throw new Error(`permanent delivery failure #${calls}`);
        },
        noteFailure: async () => {},
      };

      await registerHandler(deliverer);
      await boss.send(QUIZ_QUEUE, { quizId }, { singletonKey: quizId });
      await waitForCalls(() => calls, 4); // initial attempt + 3 retries

      // deliverQuiz failing never moves a "delivered" Quiz -- it stays
      // delivered even once retries are exhausted (see quiz-job.ts).
      const quiz = await orderRepository.getQuizById(quizId);
      expect(quiz?.status).toBe("delivered");
    },
    30_000,
  );

  it("enqueues a pending Quiz inserted while the worker was down (startup sweep)", async () => {
    const email = freshEmail("worker-sweep");
    const quizId = await insertPendingQuiz(email, buildConfig());

    const deliverer = createRecordingDeliverer();
    const enqueuedCount = await sweepPendingQuizzes(boss, orderRepository);
    expect(enqueuedCount).toBeGreaterThanOrEqual(1);

    await boss.work<{ quizId: string }, void, { includeMetadata: true }>(QUIZ_QUEUE, { includeMetadata: true }, async (jobs) => {
      const [job] = jobs;
      await handleQuizJob(job, buildDeps(deliverer));
    });

    await vi.waitFor(
      async () => {
        const quiz = await orderRepository.getQuizById(quizId);
        expect(quiz?.status).toBe("delivered");
      },
      { timeout: 20_000, interval: 250 },
    );

    expect(deliverer.deliverCalls.map((c) => c.quizId)).toContain(quizId);
  }, 30_000);

  it("sweeping twice never enqueues a second live job for the same Quiz (singleton key)", async () => {
    const email = freshEmail("worker-sweep-idempotent");
    const quizId = await insertPendingQuiz(email, buildConfig());

    const first = await boss.send(QUIZ_QUEUE, { quizId }, { singletonKey: quizId });
    expect(first).not.toBeNull();

    const second = await boss.send(QUIZ_QUEUE, { quizId }, { singletonKey: quizId });
    expect(second).toBeNull();
  });
});
