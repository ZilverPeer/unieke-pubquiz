/**
 * Integration tests for the feasibility route (spec 5, ticket #102). Runs
 * against the real local Supabase stack -- see src/repository/README.md
 * for the run sequence -- and drives the route's exported POST directly
 * (no running Next server needed), mirroring
 * src/app/api/webhooks/woocommerce/route.integration.test.ts's convention.
 * No pg-boss here: this route never enqueues anything.
 */
import { createHmac } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";
import { createRepository, resolveLocalStackConfig } from "@/repository";
import type { Database } from "@/repository/database.types";
import { createScopedCleanup } from "@/test-support/scoped-cleanup";
import { POST } from "./route";

const SECRET = "test-secret";

// Category id "1" is "Sport" (nl) -- see supabase/seed.sql section 1 and
// src/scripts/generate.integration.test.ts's own comment: 70 hard Text
// Items across the Category's Subsubcategories, more than the 60 a
// single-pick hard Quiz's 6 Text Rounds consume.
const HARD_TEXT_CATEGORY_ID = "1";
const UNKNOWN_CATEGORY_ID = "999999";

const config = resolveLocalStackConfig();
const repository = createRepository(config);
const db: SupabaseClient<Database> = createClient(config.url, config.serviceRoleKey);
const cleanup = createScopedCleanup(db);

afterEach(async () => {
  await cleanup.cleanup();
});

function freshEmail(prefix: string): string {
  return cleanup.trackEmail(`${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`);
}

function sign(body: string, secret: string = SECRET): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

function post(rawBody: string, signatureHeader: string | null): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signatureHeader !== null) headers["x-pubquiz-signature"] = signatureHeader;

  return POST(
    new Request("http://localhost/api/feasibility", {
      method: "POST",
      headers,
      body: rawBody,
    }),
  );
}

describe("POST /api/feasibility", () => {
  it("returns 401 and touches nothing for a wrong signature", async () => {
    const body = JSON.stringify({
      billingEmail: freshEmail("wrong-sig"),
      lines: [{ locale: "nl", requestedDifficulty: "hard", categoryPicks: [HARD_TEXT_CATEGORY_ID] }],
    });

    const response = await post(body, sign(body, "wrong-secret"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid signature" });
  });

  it("returns 401 with no signature header at all", async () => {
    const body = JSON.stringify({
      billingEmail: freshEmail("no-sig"),
      lines: [{ locale: "nl", requestedDifficulty: "hard", categoryPicks: [HARD_TEXT_CATEGORY_ID] }],
    });

    const response = await post(body, null);

    expect(response.status).toBe(401);
  });

  it("returns 400 for a malformed body", async () => {
    const response = await post("{not json", sign("{not json"));

    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(typeof json.error).toBe("string");
  });

  it("reports a fresh email with one pick against the seeded pool as feasible", async () => {
    const email = freshEmail("fresh");
    const body = JSON.stringify({
      billingEmail: email,
      lines: [{ locale: "nl", requestedDifficulty: "hard", categoryPicks: [HARD_TEXT_CATEGORY_ID] }],
    });

    const response = await post(body, sign(body));

    expect(response.status).toBe(200);
    const json = (await response.json()) as { lines: { feasible: boolean; invalid: string | null; shortfalls: unknown[] }[] };
    expect(json.lines).toHaveLength(1);
    expect(json.lines[0]).toEqual({ feasible: true, invalid: null, shortfalls: [] });
  });

  it("reports an unknown Category id as an invalid line, not a shortfall", async () => {
    const email = freshEmail("unknown-category");
    const body = JSON.stringify({
      billingEmail: email,
      lines: [{ locale: "nl", requestedDifficulty: "hard", categoryPicks: [UNKNOWN_CATEGORY_ID] }],
    });

    const response = await post(body, sign(body));

    expect(response.status).toBe(200);
    const json = (await response.json()) as { lines: { feasible: boolean; invalid: string | null; shortfalls: unknown[] }[] };
    expect(json.lines).toHaveLength(1);
    expect(json.lines[0].feasible).toBe(false);
    expect(json.lines[0].invalid).toMatch(new RegExp(`unknown category ${UNKNOWN_CATEGORY_ID}`, "i"));
    expect(json.lines[0].shortfalls).toEqual([]);
  });

  it(
    "reports the shortfall, with the Category id and a positive missing count, once that Category's hard Text Items are consumed for the email",
    async () => {
      const email = freshEmail("consumed");
      const pool = await repository.loadPool("nl");
      const hardTextItemIds = pool
        .filter(
          (entry) =>
            entry.item.categoryId === HARD_TEXT_CATEGORY_ID &&
            entry.item.kind === "text" &&
            entry.item.difficulty === "hard",
        )
        .map((entry) => entry.item.id);
      expect(hardTextItemIds.length).toBeGreaterThan(0);

      await repository.persistComposition({
        billingEmail: email,
        locale: "nl",
        requestedDifficulty: "hard",
        seed: 1,
        composition: { slots: [hardTextItemIds] },
      });

      const body = JSON.stringify({
        billingEmail: email,
        lines: [{ locale: "nl", requestedDifficulty: "hard", categoryPicks: [HARD_TEXT_CATEGORY_ID] }],
      });

      const response = await post(body, sign(body));

      expect(response.status).toBe(200);
      const json = (await response.json()) as {
        lines: { feasible: boolean; invalid: string | null; shortfalls: { categoryId: string | null; shortfall: number }[] }[];
      };
      expect(json.lines).toHaveLength(1);
      expect(json.lines[0].feasible).toBe(false);
      expect(json.lines[0].invalid).toBeNull();
      expect(json.lines[0].shortfalls.length).toBeGreaterThan(0);
      expect(json.lines[0].shortfalls[0].categoryId).toBe(HARD_TEXT_CATEGORY_ID);
      expect(json.lines[0].shortfalls[0].shortfall).toBeGreaterThan(0);
    },
    30_000,
  );

  it("answers two lines independently: one feasible, one invalid", async () => {
    const email = freshEmail("two-lines");
    const body = JSON.stringify({
      billingEmail: email,
      lines: [
        { locale: "nl", requestedDifficulty: "hard", categoryPicks: [HARD_TEXT_CATEGORY_ID] },
        { locale: "nl", requestedDifficulty: "hard", categoryPicks: [UNKNOWN_CATEGORY_ID] },
      ],
    });

    const response = await post(body, sign(body));

    expect(response.status).toBe(200);
    const json = (await response.json()) as { lines: { feasible: boolean; invalid: string | null }[] };
    expect(json.lines).toHaveLength(2);
    expect(json.lines[0]).toEqual({ feasible: true, invalid: null, shortfalls: [] });
    expect(json.lines[1].feasible).toBe(false);
    expect(json.lines[1].invalid).not.toBeNull();
  });
});
