/**
 * Next.js instrumentation hook (spec #36, ticket #40): starts the pg-boss
 * worker once when the Node.js server instance boots, so `next dev` and the
 * eventual container both run generation without a separate process to
 * start (CONTEXT.md "App shape"). See src/worker/README.md.
 *
 * Guarded two ways:
 * - `NEXT_RUNTIME === "nodejs"`: `register()` runs in every runtime
 *   (including Edge); pg-boss needs a real `pg` connection, so this only
 *   ever imports the worker in Node.js.
 * - `PUBQUIZ_WORKER=1`: opt-in, so `next build`, `next dev` without the
 *   flag, and the test suites never start a worker (which would otherwise
 *   hold a live pg-boss connection open and race against test cleanup).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.PUBQUIZ_WORKER !== "1") return;

  const { startWorker } = await import("./worker");
  const worker = await startWorker();

  const stop = (): void => {
    worker.stop().catch((error: unknown) => {
      console.error("[worker] error while stopping", error);
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
