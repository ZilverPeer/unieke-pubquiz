/**
 * Integration test for createQuizQueue's override behaviour (PR #53 fix
 * round). Runs against the real local Supabase stack -- see
 * src/repository/README.md for the run sequence.
 *
 * pg-boss's `createQueue` is a no-op once the queue already exists (its
 * options only take effect the first time a queue is created) -- so a
 * suite that calls `createQuizQueue(boss, { retryDelay: 1, retryBackoff:
 * false })` against a stack where `quiz-generation` was already created
 * with the production defaults silently keeps those defaults, and its
 * "fast retry" tests then wait out the real 5s/10s/20s backoff instead.
 * This is exactly what broke `quiz-job.integration.test.ts`'s
 * retry-policy suite under full-suite contention (see PR #53's fix
 * round). `createQuizQueue` now also calls `updateQueue`, whose options
 * apply on every call regardless of whether the queue already existed.
 */
import { PgBoss } from "pg-boss";
import { afterEach, describe, expect, it } from "vitest";
import { createQuizQueue, QUIZ_QUEUE, resolveDatabaseUrl } from "./boss";

describe("createQuizQueue", () => {
  let boss: PgBoss;

  afterEach(async () => {
    if (boss) await boss.stop({ graceful: false });
  });

  it("applies overrides even when the queue already exists with different (e.g. production-default) options", async () => {
    boss = new PgBoss(resolveDatabaseUrl());
    await boss.start();

    // First call: production defaults (retryLimit 3, retryDelay 5,
    // retryBackoff true) -- mirrors startBoss()'s no-overrides call, and
    // whatever a prior process (or an earlier test file, sharing this
    // stack's Postgres) already created the queue with.
    await createQuizQueue(boss);

    // Second call, same queue, fast-retry overrides -- mirrors
    // quiz-job.integration.test.ts's retry-policy suite.
    await createQuizQueue(boss, { retryLimit: 3, retryDelay: 1, retryBackoff: false });

    const queue = await boss.getQueue(QUIZ_QUEUE);

    expect(queue?.retryDelay).toBe(1);
    expect(queue?.retryBackoff).toBe(false);
    expect(queue?.retryLimit).toBe(3);
  });
});
