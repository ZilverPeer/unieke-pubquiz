/**
 * The grace-period re-probe decision for `loop:up` (ticket #136, retro
 * follow-up to the 2026-09-09 dead-app incident, see
 * docs/logbook/2026-09-08-spec3c-spec4-wave-1.md "13:58 Incident"): on
 * 2026-09-09 the app answered once, `loop:up` printed its summary and
 * exited, and the process died about five seconds later without anything
 * telling Erik. Only on the branch that spawned a fresh `next dev`,
 * `ensureAppUp` now waits `APP_GRACE_PERIOD_MS` after the first successful
 * answer and probes once more; this pure function turns the two booleans
 * that second probe produced (pid still alive, url still answering) into a
 * decision, kept separate from the process/fetch calls themselves so it's
 * unit-testable without a real process or network call (same split as
 * `isPidAlive`/`pid-alive.ts`).
 */

export interface ConfirmAppStillUpInput {
  pidAlive: boolean;
  urlAnswers: boolean;
}

export type ConfirmAppStillUpResult = { ok: true } | { ok: false; reason: "process-died" | "stopped-answering" };

/** Process death wins when both probes fail: it's the more specific, more actionable reason. */
export function confirmAppStillUp({ pidAlive, urlAnswers }: ConfirmAppStillUpInput): ConfirmAppStillUpResult {
  if (!pidAlive) return { ok: false, reason: "process-died" };
  if (!urlAnswers) return { ok: false, reason: "stopped-answering" };
  return { ok: true };
}
