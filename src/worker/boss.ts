/**
 * pg-boss instance lifecycle (spec #36, ticket #40): create, start, stop,
 * and the one queue this worker uses. pg-boss stores its own state in the
 * same Postgres the app already uses -- it creates a `pgboss` schema on
 * first start (see README.md "The `pgboss` schema").
 */
import { PgBoss } from "pg-boss";

/** The only queue the worker uses: one Quiz generation job per Quiz. */
export const QUIZ_QUEUE = "quiz-generation";

// Supabase CLI's local demo Postgres -- same DB the repository's
// resolveLocalStackConfig() falls back to (see src/repository/local-stack-config.ts),
// expressed as a connection string because pg-boss (via `pg`) speaks
// Postgres wire protocol directly rather than PostgREST. Local-dev only.
const DEFAULT_LOCAL_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:45322/postgres";

/**
 * Resolves the Postgres connection string pg-boss uses as its own store:
 * `DATABASE_URL` from the environment, falling back to the local Supabase
 * stack's default port (see supabase/config.toml; ports 45320-45329).
 */
export function resolveDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL;
}

/**
 * Overrides applied on top of the queue's defaults -- test-only escape
 * hatch for fast retries. `pollingIntervalSeconds` is deliberately not
 * here: it is a `boss.work()`-time option (pg-boss's `JobPollingOptions`,
 * default 2s idle poll), not a `createQueue` one -- `createQueue` has no
 * such option and silently ignores an unknown key, so passing it here
 * would look like it worked without ever taking effect. A caller that
 * wants faster polling passes `pollingIntervalSeconds` in its own
 * `boss.work(name, { pollingIntervalSeconds, ... }, handler)` call instead
 * (see quiz-job.integration.test.ts's retry-policy suite).
 */
export interface QuizQueueOverrides {
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
}

/**
 * `exclusive`, extended with a per-job `singletonKey` (the Quiz id, set by
 * the caller on send()): at most one queued-or-active job per Quiz at a
 * time, so a Quiz never has two live jobs (a retried job and a sweep-enqueued
 * duplicate can never coexist). Three retries with exponential backoff by
 * default for retryable failures (see quiz-job.ts); a terminal failure
 * (shortfall, invalid config) completes the job directly instead of
 * throwing, so it is never retried regardless of this policy.
 *
 * `createQueue`'s options only take effect the first time the queue is
 * created -- pg-boss stores its own state in Postgres, so a later call
 * against a stack where `quiz-generation` already exists (a prior process,
 * or an earlier test file sharing this suite's Postgres -- see
 * vitest.integration.config.mts's `fileParallelism: false`) would
 * otherwise silently keep whichever options created it first (PR #53's fix
 * round: this is what broke quiz-job.integration.test.ts's retry-policy
 * suite under full-suite contention -- its fast-retry overrides never
 * applied against a queue `startBoss()`'s no-overrides call had already
 * created with the production defaults). `updateQueue` applies its options
 * on every call regardless, so it's called every time too -- the process
 * that starts last always wins, which is what the worker wants at startup
 * (its own defaults should win over a stale queue from a previous run) and
 * what the tests need. `policy` isn't part of `UpdateQueueOptions` (it's
 * fixed at creation), so it stays on `createQueue` only.
 */
export async function createQuizQueue(boss: PgBoss, overrides: QuizQueueOverrides = {}): Promise<void> {
  const retryLimit = overrides.retryLimit ?? 3;
  const retryBackoff = overrides.retryBackoff ?? true;
  const retryDelay = overrides.retryDelay ?? 5;

  await boss.createQueue(QUIZ_QUEUE, { policy: "exclusive", retryLimit, retryBackoff, retryDelay });
  await boss.updateQueue(QUIZ_QUEUE, { retryLimit, retryBackoff, retryDelay });
}

/** Creates and starts a pg-boss instance against `resolveDatabaseUrl()`, with the quiz queue created. */
export async function startBoss(overrides: QuizQueueOverrides = {}): Promise<PgBoss> {
  const boss = new PgBoss(resolveDatabaseUrl());
  boss.on("error", (error) => {
    console.error("[worker] pg-boss error", error);
  });
  await boss.start();
  await createQuizQueue(boss, overrides);
  return boss;
}

/** Stops a pg-boss instance gracefully, letting in-flight jobs finish before closing the connection pool. */
export async function stopBoss(boss: PgBoss): Promise<void> {
  await boss.stop({ graceful: true, timeout: 10_000 });
}
