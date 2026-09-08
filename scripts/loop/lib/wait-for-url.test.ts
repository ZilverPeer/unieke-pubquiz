import { describe, expect, test, vi } from "vitest";
import { waitUntilUrlAnswers } from "./wait-for-url";

/**
 * Unit seam for ticket #59's `loop:up`: the "poll a URL until it answers, or
 * time out" loop, driven against a fake fetch and a fake sleep so the suite
 * never actually waits. Never imports up.ts/down.ts.
 */
describe("waitUntilUrlAnswers", () => {
  test("resolves true as soon as fetch succeeds", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    const result = await waitUntilUrlAnswers("http://localhost:3000", {
      timeoutMs: 1000,
      intervalMs: 10,
      fetchFn,
      sleepFn,
    });

    expect(result).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith("http://localhost:3000");
    expect(sleepFn).not.toHaveBeenCalled();
  });

  test("retries after a failed fetch until it succeeds", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce({ ok: true });
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    const result = await waitUntilUrlAnswers("http://localhost:3000", {
      timeoutMs: 1000,
      intervalMs: 10,
      fetchFn,
      sleepFn,
    });

    expect(result).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleepFn).toHaveBeenCalledTimes(2);
  });

  test("gives up and resolves false once elapsed time exceeds the timeout", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    let now = 0;
    const nowFn = vi.fn(() => {
      now += 40;
      return now;
    });

    const result = await waitUntilUrlAnswers("http://localhost:3000", {
      timeoutMs: 100,
      intervalMs: 10,
      fetchFn,
      sleepFn,
      nowFn,
    });

    expect(result).toBe(false);
  });
});
