/**
 * This area's own pg-boss connection for the retry action (spec 4, ticket
 * #93) -- same lazy-singleton shape as
 * src/app/api/webhooks/woocommerce/boss-client.ts (one connection per
 * server process, started on first retry and reused after that). A
 * separate small module rather than importing the webhook route's own
 * boss-client.ts: that file is private to the webhook route (its docblock
 * says so), and this area's server actions have no reason to share its
 * connection's lifecycle with an unrelated route.
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
