/**
 * Integration test for the scoped-cleanup helper itself (ticket #51) --
 * the seam every other integration suite's cleanup now goes through. Runs
 * against the real local Supabase stack -- see src/repository/README.md
 * for the run sequence.
 *
 * Proves the one property that matters: cleanup() deletes exactly what was
 * tracked (by billing email, and by quiz id for the Order-less case) and
 * leaves a foreign row -- one belonging to nobody this test tracked --
 * untouched. That foreign row stands in for a real order placed through
 * the shop, or another suite's fixture, on the same shared stack.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { resolveLocalStackConfig } from "@/repository";
import type { Database } from "@/repository/database.types";
import { createScopedCleanup } from "./scoped-cleanup";

const config = resolveLocalStackConfig();
const db: SupabaseClient<Database> = createClient(config.url, config.serviceRoleKey);

let nextWooOrderId = 990_000;
function freshWooOrderId(): number {
  return nextWooOrderId++;
}

function freshEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`;
}

async function insertOrder(billingEmail: string): Promise<string> {
  const { data, error } = await db
    .from("orders")
    .insert({
      woo_order_id: freshWooOrderId(),
      billing_email: billingEmail,
      status: "processing",
      raw_payload: {},
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function insertQuiz(orderId: string): Promise<string> {
  const { data, error } = await db
    .from("quizzes")
    .insert({
      order_id: orderId,
      woo_line_item_id: 1,
      sequence: 0,
      status: "pending",
      locale: "nl",
      quiz_mode: "mixed",
      requested_difficulty: "mixed",
      category_picks: new Array(8).fill(null),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function insertComposition(billingEmail: string): Promise<string> {
  const { data, error } = await db
    .from("compositions")
    .insert({
      billing_email: billingEmail,
      locale: "nl",
      quiz_mode: "mixed",
      requested_difficulty: "mixed",
      seed: 1,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function orderExists(orderId: string): Promise<boolean> {
  const { data, error } = await db.from("orders").select("id").eq("id", orderId).maybeSingle();
  if (error) throw error;
  return data !== null;
}

async function quizExists(quizId: string): Promise<boolean> {
  const { data, error } = await db.from("quizzes").select("id").eq("id", quizId).maybeSingle();
  if (error) throw error;
  return data !== null;
}

async function compositionExists(compositionId: string): Promise<boolean> {
  const { data, error } = await db.from("compositions").select("id").eq("id", compositionId).maybeSingle();
  if (error) throw error;
  return data !== null;
}

// Every foreign row this file inserts as a "leave alone" fixture, deleted
// directly (not through the helper under test) once the whole file is
// done -- this suite must not itself leak rows onto the shared stack.
const foreignEmailsToDelete: string[] = [];

afterAll(async () => {
  if (foreignEmailsToDelete.length === 0) return;
  const { error: quizzesError } = await db
    .from("quizzes")
    .delete()
    .in("order_id", (await db.from("orders").select("id").in("billing_email", foreignEmailsToDelete)).data?.map((o) => o.id) ?? []);
  if (quizzesError) throw quizzesError;
  const { error: ordersError } = await db.from("orders").delete().in("billing_email", foreignEmailsToDelete);
  if (ordersError) throw ordersError;
  const { error: compositionsError } = await db.from("compositions").delete().in("billing_email", foreignEmailsToDelete);
  if (compositionsError) throw compositionsError;
});

describe("createScopedCleanup", () => {
  it("deletes only the tracked billing email's Order and Quiz, leaving a foreign Order and Quiz alone", async () => {
    const cleanup = createScopedCleanup(db);

    const trackedEmail = cleanup.trackEmail(freshEmail("scoped-cleanup-tracked"));
    const trackedOrderId = await insertOrder(trackedEmail);
    const trackedQuizId = await insertQuiz(trackedOrderId);

    const foreignEmail = freshEmail("scoped-cleanup-foreign");
    foreignEmailsToDelete.push(foreignEmail);
    const foreignOrderId = await insertOrder(foreignEmail);
    const foreignQuizId = await insertQuiz(foreignOrderId);

    await cleanup.cleanup();

    expect(await orderExists(trackedOrderId)).toBe(false);
    expect(await quizExists(trackedQuizId)).toBe(false);
    expect(await orderExists(foreignOrderId)).toBe(true);
    expect(await quizExists(foreignQuizId)).toBe(true);
  });

  it("deletes only the tracked billing email's Composition, leaving a foreign Composition alone", async () => {
    const cleanup = createScopedCleanup(db);

    const trackedEmail = cleanup.trackEmail(freshEmail("scoped-cleanup-comp-tracked"));
    const trackedCompositionId = await insertComposition(trackedEmail);

    const foreignEmail = freshEmail("scoped-cleanup-comp-foreign");
    foreignEmailsToDelete.push(foreignEmail);
    const foreignCompositionId = await insertComposition(foreignEmail);

    await cleanup.cleanup();

    expect(await compositionExists(trackedCompositionId)).toBe(false);
    expect(await compositionExists(foreignCompositionId)).toBe(true);
  });

  it("trackQuizId deletes an explicitly tracked Quiz without touching its Order-less sibling's foreign Order", async () => {
    const cleanup = createScopedCleanup(db);

    const orderLessEmail = freshEmail("scoped-cleanup-quizid");
    const orderId = await insertOrder(orderLessEmail);
    const quizId = cleanup.trackQuizId(await insertQuiz(orderId));

    const foreignEmail = freshEmail("scoped-cleanup-quizid-foreign");
    foreignEmailsToDelete.push(foreignEmail);
    const foreignOrderId = await insertOrder(foreignEmail);
    const foreignQuizId = await insertQuiz(foreignOrderId);

    await cleanup.cleanup();

    expect(await quizExists(quizId)).toBe(false);
    // The tracked Quiz's Order was never tracked by email, so it's left
    // behind -- trackQuizId only ever removes the Quiz row itself.
    expect(await orderExists(orderId)).toBe(true);
    expect(await orderExists(foreignOrderId)).toBe(true);
    expect(await quizExists(foreignQuizId)).toBe(true);

    // Clean up the leftover Order-less Order directly; not the property
    // under test.
    const { error } = await db.from("orders").delete().eq("id", orderId);
    if (error) throw error;
  });

  it("is a no-op when nothing was tracked", async () => {
    const cleanup = createScopedCleanup(db);
    await expect(cleanup.cleanup()).resolves.toBeUndefined();
  });
});
