/**
 * Order and Quiz persistence (spec #36, ticket #38). Private helper for
 * src/repository/index.ts -- see README.md.
 *
 * Upserting is idempotent on `woo_order_id` (orders) and on
 * `(order_id, woo_line_item_id, sequence)` (quizzes): a second call with the
 * same input never duplicates rows and never resets a Quiz that already left
 * `pending`. Status transitions are enforced against QUIZ_STATUS_TRANSITIONS.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CategoryPick, OrderRecord, QuizConfig, QuizRecord, QuizStatus } from "@/domain";
import { QUIZ_STATUS_TRANSITIONS } from "@/domain";
import type { Database, Json } from "./database.types";

type OrderRow = Database["public"]["Tables"]["orders"]["Row"];
type QuizRow = Database["public"]["Tables"]["quizzes"]["Row"];

/** Thrown by transitionQuizStatus/recordDelivery for an edge not in QUIZ_STATUS_TRANSITIONS. */
export class IllegalQuizTransitionError extends Error {
  constructor(
    readonly quizId: string,
    readonly from: QuizStatus,
    readonly to: QuizStatus,
  ) {
    super(`Quiz ${quizId} cannot transition from "${from}" to "${to}"`);
    this.name = "IllegalQuizTransitionError";
  }
}

/** One line item of a parsed WooCommerce order, as the webhook hands it to the repository. */
export interface OrderLineItem {
  wooLineItemId: number;
  quantity: number;
  config: QuizConfig;
}

export interface UpsertOrderInput {
  wooOrderId: number;
  billingEmail: string;
  wooStatus: string;
  rawPayload: unknown;
  lineItems: readonly OrderLineItem[];
}

// See compositions.ts's normalizeBillingEmail -- same rule, same reason
// (CONTEXT.md "No-repeat rule"), duplicated rather than shared because the
// two modules are independent helpers with no shared private module.
function normalizeBillingEmail(billingEmail: string): string {
  return billingEmail.trim().toLowerCase();
}

function toOrderRecord(row: OrderRow): OrderRecord {
  return {
    id: row.id,
    wooOrderId: row.woo_order_id,
    billingEmail: row.billing_email,
    wooStatus: row.status,
    createdAt: row.created_at,
  };
}

function toCategoryPicks(value: Json): CategoryPick[] {
  // jsonb has no "undefined": a CategoryPick[]'s undefined entries
  // (unassigned slots) come back from Postgres as null. Convert back on the
  // way out so QuizRecord matches the domain shape (QuizConfig.categoryPicks
  // is `string | undefined`, not `string | null`).
  return (value as (string | null)[]).map((pick) => pick ?? undefined);
}

function toQuizRecord(row: QuizRow): QuizRecord {
  return {
    id: row.id,
    orderId: row.order_id,
    wooLineItemId: row.woo_line_item_id,
    sequence: row.sequence,
    config: {
      locale: row.locale,
      quizMode: row.quiz_mode,
      categoryPicks: toCategoryPicks(row.category_picks),
      requestedDifficulty: row.requested_difficulty,
    },
    status: row.status,
    failureReason: row.failure_reason,
    compositionId: row.composition_id,
    downloadToken: row.download_token,
    deliveredAt: row.delivered_at,
  };
}

export async function upsertOrder(
  client: SupabaseClient<Database>,
  input: UpsertOrderInput,
): Promise<{ order: OrderRecord; quizzes: QuizRecord[] }> {
  const { data: orderRow, error: orderError } = await client
    .from("orders")
    .upsert(
      {
        woo_order_id: input.wooOrderId,
        billing_email: normalizeBillingEmail(input.billingEmail),
        status: input.wooStatus,
        raw_payload: input.rawPayload as Database["public"]["Tables"]["orders"]["Insert"]["raw_payload"],
      },
      { onConflict: "woo_order_id" },
    )
    .select()
    .single();
  if (orderError) throw orderError;

  const quizRowsToInsert = input.lineItems.flatMap((lineItem) =>
    Array.from({ length: lineItem.quantity }, (_, sequence) => ({
      order_id: orderRow.id,
      woo_line_item_id: lineItem.wooLineItemId,
      sequence,
      locale: lineItem.config.locale,
      quiz_mode: lineItem.config.quizMode,
      requested_difficulty: lineItem.config.requestedDifficulty,
      category_picks: lineItem.config.categoryPicks as Database["public"]["Tables"]["quizzes"]["Insert"]["category_picks"],
    })),
  );

  if (quizRowsToInsert.length > 0) {
    // Insert-only, ignoring conflicts: a Quiz row that already exists may
    // have left `pending` and must never be reset by a repeated webhook
    // delivery, so this never upserts (which would rewrite status/config).
    const { error: insertError } = await client
      .from("quizzes")
      .upsert(quizRowsToInsert, { onConflict: "order_id,woo_line_item_id,sequence", ignoreDuplicates: true });
    if (insertError) throw insertError;
  }

  const { data: quizRows, error: quizzesError } = await client
    .from("quizzes")
    .select()
    .eq("order_id", orderRow.id)
    .order("woo_line_item_id", { ascending: true })
    .order("sequence", { ascending: true });
  if (quizzesError) throw quizzesError;

  return {
    order: toOrderRecord(orderRow),
    quizzes: quizRows.map(toQuizRecord),
  };
}

async function fetchQuizOrThrow(client: SupabaseClient<Database>, quizId: string): Promise<QuizRow> {
  const { data, error } = await client.from("quizzes").select().eq("id", quizId).single();
  if (error) throw error;
  return data;
}

function assertLegalTransition(quizId: string, from: QuizStatus, to: QuizStatus): void {
  if (!QUIZ_STATUS_TRANSITIONS[from].includes(to)) {
    throw new IllegalQuizTransitionError(quizId, from, to);
  }
}

/**
 * Thrown when the compare-and-swap `.eq("status", expectedFrom)` guard in
 * transitionQuizStatus/recordDelivery matches zero rows: another writer
 * changed the Quiz's status between the read and the write. Distinct from
 * IllegalQuizTransitionError (which fires before any write, from a status
 * this caller itself observed) so a caller such as the worker can retry a
 * lost race instead of treating it as an illegal edge.
 */
export class QuizStatusChangedConcurrentlyError extends Error {
  constructor(
    readonly quizId: string,
    readonly expectedFrom: QuizStatus,
  ) {
    super(`Quiz ${quizId} was expected to still be "${expectedFrom}" but changed concurrently`);
    this.name = "QuizStatusChangedConcurrentlyError";
  }
}

export interface TransitionQuizStatusOptions {
  /** Stored on `failed`; ignored otherwise. Cleared automatically on `pending`. */
  failureReason?: string;
}

export async function transitionQuizStatus(
  client: SupabaseClient<Database>,
  quizId: string,
  to: QuizStatus,
  options: TransitionQuizStatusOptions = {},
): Promise<QuizRecord> {
  const current = await fetchQuizOrThrow(client, quizId);
  assertLegalTransition(quizId, current.status, to);

  const { data, error } = await client
    .from("quizzes")
    .update({
      status: to,
      failure_reason: to === "failed" ? (options.failureReason ?? null) : to === "pending" ? null : current.failure_reason,
    })
    .eq("id", quizId)
    .eq("status", current.status)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new QuizStatusChangedConcurrentlyError(quizId, current.status);

  return toQuizRecord(data);
}

export interface RecordDeliveryInput {
  compositionId: string;
  downloadToken: string;
}

export async function recordDelivery(
  client: SupabaseClient<Database>,
  quizId: string,
  input: RecordDeliveryInput,
): Promise<QuizRecord> {
  const current = await fetchQuizOrThrow(client, quizId);
  assertLegalTransition(quizId, current.status, "delivered");

  const { data, error } = await client
    .from("quizzes")
    .update({
      status: "delivered",
      composition_id: input.compositionId,
      download_token: input.downloadToken,
      delivered_at: new Date().toISOString(),
    })
    .eq("id", quizId)
    .eq("status", current.status)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new QuizStatusChangedConcurrentlyError(quizId, current.status);

  return toQuizRecord(data);
}

export async function clearDownloadToken(client: SupabaseClient<Database>, quizId: string): Promise<void> {
  const { error } = await client.from("quizzes").update({ download_token: null }).eq("id", quizId);
  if (error) throw error;
}

export async function listQuizzesByBillingEmail(
  client: SupabaseClient<Database>,
  billingEmail: string,
): Promise<QuizRecord[]> {
  const { data, error } = await client
    .from("quizzes")
    .select("*, orders!inner(billing_email)")
    .eq("orders.billing_email", normalizeBillingEmail(billingEmail))
    .order("created_at", { ascending: false });
  if (error) throw error;

  return data.map((row) => toQuizRecord(row));
}

export async function listQuizzesDeliveredBefore(
  client: SupabaseClient<Database>,
  cutoff: Date,
): Promise<QuizRecord[]> {
  const { data, error } = await client
    .from("quizzes")
    .select()
    .eq("status", "delivered")
    .not("download_token", "is", null)
    .lt("delivered_at", cutoff.toISOString());
  if (error) throw error;

  return data.map(toQuizRecord);
}

export async function getQuizById(client: SupabaseClient<Database>, quizId: string): Promise<QuizRecord | null> {
  const { data, error } = await client.from("quizzes").select().eq("id", quizId).maybeSingle();
  if (error) throw error;
  return data ? toQuizRecord(data) : null;
}

export async function getQuizByDownloadToken(
  client: SupabaseClient<Database>,
  downloadToken: string,
): Promise<QuizRecord | null> {
  const { data, error } = await client.from("quizzes").select().eq("download_token", downloadToken).maybeSingle();
  if (error) throw error;
  return data ? toQuizRecord(data) : null;
}

export async function listPendingQuizzes(client: SupabaseClient<Database>): Promise<QuizRecord[]> {
  const { data, error } = await client.from("quizzes").select().eq("status", "pending");
  if (error) throw error;
  return data.map(toQuizRecord);
}

/**
 * Added for the worker (ticket #40): generateQuiz needs the order's billing
 * email, which QuizRecord doesn't carry (billing email lives on `orders`,
 * not denormalised onto `quizzes` -- see CONTEXT.md "Order"/"Quiz"). Mirrors
 * getQuizById's null-when-missing shape.
 */
export async function getOrderById(client: SupabaseClient<Database>, orderId: string): Promise<OrderRecord | null> {
  const { data, error } = await client.from("orders").select().eq("id", orderId).maybeSingle();
  if (error) throw error;
  return data ? toOrderRecord(data) : null;
}
