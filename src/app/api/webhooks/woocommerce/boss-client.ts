/**
 * The route's own pg-boss connection (spec #36, ticket #39), kept out of
 * route.ts so the module stays a thin Request/Response adapter. One
 * connection per server process, started lazily on first delivery and
 * reused after that -- starting a fresh one per request would pay
 * pg-boss's schema-check cost on every webhook call for no reason.
 * Enqueueing (`send`) needs no `work()` handler registered here: consuming
 * jobs is the worker's job (src/instrumentation.ts, PUBQUIZ_WORKER=1),
 * entirely separate from this route being able to enqueue them.
 */
import type { PgBoss } from "pg-boss";
import { startBoss, stopBoss } from "@/worker/boss";

let bossPromise: Promise<PgBoss> | null = null;

export function getBoss(): Promise<PgBoss> {
  if (!bossPromise) bossPromise = startBoss();
  return bossPromise;
}

/** Test-only: closes the lazily-started connection so a test run doesn't hang on an open handle. */
export async function closeBossForTests(): Promise<void> {
  if (!bossPromise) return;
  const promise = bossPromise;
  bossPromise = null;
  await stopBoss(await promise);
}
