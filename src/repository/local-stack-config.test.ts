/**
 * Ticket #123: resolveLocalStackConfig must cache the CLI fallback's parsed
 * result in module scope for the life of the process (issue #123 measured
 * `npx supabase status -o env` at 4-5 s and it was running on every request).
 * Uses resolveLocalStackConfigWith's injectable { env, exec } seam so this
 * never spawns the real CLI. Never asserts on or logs a real key -- the stub
 * output below is a fake local-looking pair only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetLocalStackConfigCache,
  resolveLocalStackConfigWith,
} from "./local-stack-config";

// `supabase status -o env`'s own key for the URL is API_URL (parseStatusEnv
// reads it as such); the fake value itself is the non-secret pair the brief
// names.
const FAKE_STATUS_OUTPUT = 'API_URL="http://127.0.0.1:1/"\nSERVICE_ROLE_KEY="fake"\n';

beforeEach(() => {
  __resetLocalStackConfigCache();
});

describe("resolveLocalStackConfigWith", () => {
  it("runs the exec stub once and caches the result across two calls", () => {
    const exec = vi.fn().mockReturnValue(FAKE_STATUS_OUTPUT);

    const first = resolveLocalStackConfigWith({ env: {}, exec });
    const second = resolveLocalStackConfigWith({ env: {}, exec });

    expect(first).toEqual(second);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("never runs the exec stub when the environment already has both values", () => {
    const exec = vi.fn().mockReturnValue(FAKE_STATUS_OUTPUT);

    const config = resolveLocalStackConfigWith({
      env: { SUPABASE_URL: "http://127.0.0.1:1/", SUPABASE_SERVICE_ROLE_KEY: "fake" },
      exec,
    });

    expect(config).toEqual({ url: "http://127.0.0.1:1/", serviceRoleKey: "fake" });
    expect(exec).not.toHaveBeenCalled();
  });

  it("does not cache a throwing exec stub, so the next call retries", () => {
    const exec = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("stub CLI failure");
      })
      .mockReturnValueOnce(FAKE_STATUS_OUTPUT);

    expect(() => resolveLocalStackConfigWith({ env: {}, exec })).toThrow("stub CLI failure");

    const config = resolveLocalStackConfigWith({ env: {}, exec });

    expect(config).toEqual({ url: "http://127.0.0.1:1/", serviceRoleKey: "fake" });
    expect(exec).toHaveBeenCalledTimes(2);
  });
});
