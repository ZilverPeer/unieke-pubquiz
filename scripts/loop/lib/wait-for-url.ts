/**
 * Polls a URL until it answers (any resolved fetch, `ok` or not -- reaching
 * the server at all is the signal, not a particular status code) or a
 * timeout elapses -- `loop/up.ts` (ticket #59) uses this both to detect an
 * already-running app (a short timeout, single attempt) and to wait for a
 * freshly spawned `next dev` to come up (a long timeout). `fetchFn`,
 * `sleepFn` and `nowFn` are injectable so the unit tests never actually wait
 * or make a real network call.
 */

export interface WaitUntilUrlAnswersOptions {
  timeoutMs: number;
  intervalMs: number;
  fetchFn?: (url: string) => Promise<{ ok: boolean }>;
  sleepFn?: (ms: number) => Promise<void>;
  nowFn?: () => number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves true as soon as `fetchFn(url)` resolves, false once `timeoutMs` has elapsed without that happening. */
export async function waitUntilUrlAnswers(url: string, options: WaitUntilUrlAnswersOptions): Promise<boolean> {
  const { timeoutMs, intervalMs } = options;
  const fetchFn = options.fetchFn ?? ((target: string) => fetch(target));
  const sleepFn = options.sleepFn ?? defaultSleep;
  const nowFn = options.nowFn ?? Date.now;

  const deadline = nowFn() + timeoutMs;

  for (;;) {
    try {
      await fetchFn(url);
      return true;
    } catch {
      // Not up yet -- fall through to the timeout check/sleep below.
    }

    if (nowFn() >= deadline) return false;
    await sleepFn(intervalMs);
  }
}
