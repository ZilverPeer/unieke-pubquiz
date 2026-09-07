/**
 * Integration tests for the webhook route (spec #36, ticket #39). Runs
 * against the real local Supabase stack and a real pg-boss instance -- see
 * src/repository/README.md for the run sequence. Drives the route's
 * exported POST directly (no need for a running Next server), mirroring
 * src/app/download/[token]/[file]/route.integration.test.ts's convention.
 * Nothing about the repository or pg-boss is faked here (that's what the
 * unit tests, handle-webhook.test.ts, are for).
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resolveLocalStackConfig } from "@/repository";
import type { Database } from "@/repository/database.types";
import { resolveDatabaseUrl } from "@/worker/boss";
import { closeBossForTests } from "./boss-client";
import { POST } from "./route";

const SECRET = "test-secret";
const FIXTURE_PATH = join(process.cwd(), "shop/fixtures/order-updated-processing.json");

const config = resolveLocalStackConfig();
const db: SupabaseClient<Database> = createClient(config.url, config.serviceRoleKey);

function loadFixtureBody(): Record<string, unknown> {
  const captured = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as { body: unknown };
  return captured.body as Record<string, unknown>;
}

function sign(body: string, secret: string = SECRET): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

function post(rawBody: string, signatureHeader: string | null): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signatureHeader !== null) headers["x-wc-webhook-signature"] = signatureHeader;

  return POST(
    new Request("http://localhost/api/webhooks/woocommerce", {
      method: "POST",
      headers,
      body: rawBody,
    }),
  );
}

async function countJobsForQueue(quizIds: string[]): Promise<number> {
  const client = new Client({ connectionString: resolveDatabaseUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<{ count: string }>(
      `select count(*)::text as count from pgboss.job where name = 'quiz-generation' and data->>'quizId' = any($1::text[])`,
      [quizIds],
    );
    return Number(rows[0].count);
  } finally {
    await client.end();
  }
}

beforeEach(async () => {
  const { error: quizzesError } = await db.from("quizzes").delete().not("id", "is", null);
  if (quizzesError) throw quizzesError;
  const { error: ordersError } = await db.from("orders").delete().not("id", "is", null);
  if (ordersError) throw ordersError;
});

afterAll(async () => {
  await closeBossForTests();
});

describe("POST /api/webhooks/woocommerce", () => {
  it("returns 401 and persists nothing for a wrong signature", async () => {
    const body = loadFixtureBody();
    const rawBody = JSON.stringify(body);

    const response = await post(rawBody, sign(rawBody, "wrong-secret"));

    expect(response.status).toBe(401);
    const { data: orders } = await db.from("orders").select().eq("woo_order_id", body.id as number);
    expect(orders).toHaveLength(0);
  });

  it("returns 200 and persists nothing when the order status is not processing", async () => {
    const body: Record<string, unknown> = { ...loadFixtureBody(), status: "on-hold" };
    const rawBody = JSON.stringify(body);

    const response = await post(rawBody, sign(rawBody));

    expect(response.status).toBe(200);
    const { data: orders } = await db.from("orders").select().eq("woo_order_id", body.id as number);
    expect(orders).toHaveLength(0);
  });

  it(
    "two deliveries of the same valid payload leave one order, the same Quiz rows, and exactly one job per Quiz",
    async () => {
      const body = loadFixtureBody();
      const rawBody = JSON.stringify(body);

      const first = await post(rawBody, sign(rawBody));
      expect(first.status).toBe(200);

      const { data: quizzesAfterFirst } = await db.from("quizzes").select();
      expect(quizzesAfterFirst).toHaveLength(1);
      const quizId = quizzesAfterFirst![0].id;

      const second = await post(rawBody, sign(rawBody));
      expect(second.status).toBe(200);

      const { data: orders } = await db.from("orders").select().eq("woo_order_id", body.id as number);
      expect(orders).toHaveLength(1);

      const { data: quizzesAfterSecond } = await db.from("quizzes").select();
      expect(quizzesAfterSecond).toHaveLength(1);
      expect(quizzesAfterSecond![0].id).toBe(quizId);

      const jobCount = await countJobsForQueue([quizId]);
      expect(jobCount).toBe(1);
    },
    30_000,
  );

  it(
    "a line item with one bad Category pick yields one failed Quiz with a reason; siblings stay pending with a job",
    async () => {
      const body = loadFixtureBody();
      const lineItems = JSON.parse(JSON.stringify(body.line_items)) as { meta_data: { key: string; value: unknown }[] }[];
      // Quantity 2 so this proves siblings of a *failed* unit still get their own job.
      lineItems.push({
        ...JSON.parse(JSON.stringify(lineItems[0])),
        id: 999,
        quantity: 1,
      });
      lineItems[1].meta_data = lineItems[1].meta_data.map((entry) =>
        entry.key === "pubquiz_category_1" ? { ...entry, value: "999" } : entry,
      );
      const rawBody = JSON.stringify({ ...body, line_items: lineItems });

      const response = await post(rawBody, sign(rawBody));
      expect(response.status).toBe(200);

      const { data: quizzes } = await db.from("quizzes").select().order("woo_line_item_id", { ascending: true });
      expect(quizzes).toHaveLength(2);

      const good = quizzes!.find((q) => q.status === "pending");
      const bad = quizzes!.find((q) => q.status === "failed");

      expect(bad).toBeDefined();
      expect(bad!.failure_reason).toMatch(/unknown category id "999"/i);
      expect(good).toBeDefined();
      expect(good!.status).toBe("pending");

      const goodJobCount = await countJobsForQueue([good!.id]);
      expect(goodJobCount).toBe(1);
      const badJobCount = await countJobsForQueue([bad!.id]);
      expect(badJobCount).toBe(0);
    },
    30_000,
  );

  it("quantity n on a line item yields n Quiz rows and n jobs", async () => {
    const body = loadFixtureBody();
    const lineItems = JSON.parse(JSON.stringify(body.line_items)) as Record<string, unknown>[];
    lineItems[0] = { ...lineItems[0], quantity: 3 };
    const rawBody = JSON.stringify({ ...body, line_items: lineItems });

    const response = await post(rawBody, sign(rawBody));
    expect(response.status).toBe(200);

    const { data: quizzes } = await db.from("quizzes").select();
    expect(quizzes).toHaveLength(3);

    const jobCount = await countJobsForQueue(quizzes!.map((q) => q.id));
    expect(jobCount).toBe(3);
  }, 30_000);
});
