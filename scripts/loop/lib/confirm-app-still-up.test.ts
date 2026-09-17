import { describe, expect, test } from "vitest";
import { confirmAppStillUp } from "./confirm-app-still-up";

/**
 * Unit seam for ticket #136: after `loop:up` spawns a fresh `next dev` and it
 * first answers, a grace-period re-probe decides whether the app is really
 * still up (pid alive and the URL still answering) or whether it died right
 * after coming up (the 2026-09-09 incident, see docs/logbook). Pure decision
 * function, in the style of pid-alive.test.ts: no real process, no real
 * fetch, just the two booleans the caller already probed.
 */
describe("confirmAppStillUp", () => {
  test("pid alive and url answering: ok", () => {
    const result = confirmAppStillUp({ pidAlive: true, urlAnswers: true });
    expect(result).toEqual({ ok: true });
  });

  test("pid dead, url answering: process-died", () => {
    const result = confirmAppStillUp({ pidAlive: false, urlAnswers: true });
    expect(result).toEqual({ ok: false, reason: "process-died" });
  });

  test("pid alive, url silent: stopped-answering", () => {
    const result = confirmAppStillUp({ pidAlive: true, urlAnswers: false });
    expect(result).toEqual({ ok: false, reason: "stopped-answering" });
  });

  test("pid dead and url silent: process-died wins", () => {
    const result = confirmAppStillUp({ pidAlive: false, urlAnswers: false });
    expect(result).toEqual({ ok: false, reason: "process-died" });
  });
});
