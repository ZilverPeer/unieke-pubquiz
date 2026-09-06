/**
 * Excluded-item lookup and Composition persistence. Private helper for
 * src/repository/index.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompositionRecord } from "@/domain";
import { SLOT_COUNT } from "@/domain";
import type { Database } from "./database.types";

// Billing email is the no-repeat rule's key, but WooCommerce doesn't
// guarantee consistent case or whitespace across orders for the same
// customer -- see CONTEXT.md "No-repeat rule". Normalised here, the one
// place both read (loadExcludedItemIds) and write (persistComposition) sides
// go through, rather than in a DB constraint/migration.
function normalizeBillingEmail(billingEmail: string): string {
  return billingEmail.trim().toLowerCase();
}

export async function loadExcludedItemIds(
  client: SupabaseClient<Database>,
  billingEmail: string,
): Promise<Set<string>> {
  const { data, error } = await client
    .from("composition_items")
    .select("item_id, compositions!inner(billing_email)")
    .eq("compositions.billing_email", normalizeBillingEmail(billingEmail));

  if (error) throw error;

  return new Set(data.map((row) => row.item_id));
}

export async function persistComposition(
  client: SupabaseClient<Database>,
  record: CompositionRecord,
): Promise<{ compositionId: string }> {
  const { data: composition, error: compositionError } = await client
    .from("compositions")
    .insert({
      billing_email: normalizeBillingEmail(record.billingEmail),
      locale: record.locale,
      quiz_mode: record.quizMode,
      requested_difficulty: record.requestedDifficulty,
      seed: record.seed,
    })
    .select("id")
    .single();

  if (compositionError) throw compositionError;

  const rows = record.composition.slots.flatMap((slot, slotIndex) =>
    slot.map((itemId, position) => ({
      composition_id: composition.id,
      slot_index: slotIndex,
      position,
      item_id: itemId,
    })),
  );

  const { error: itemsError } = await client.from("composition_items").insert(rows);
  if (itemsError) throw itemsError;

  return { compositionId: composition.id };
}

/**
 * Reads a persisted Composition back out, for the `--composition` dev
 * script flag (ticket #42): re-rendering an existing Composition never
 * re-samples, so it needs the exact slots (in slot/position order) rather
 * than a fresh sample.
 */
export async function getCompositionById(
  client: SupabaseClient<Database>,
  compositionId: string,
): Promise<CompositionRecord | null> {
  const { data: compositionRow, error: compositionError } = await client
    .from("compositions")
    .select()
    .eq("id", compositionId)
    .maybeSingle();
  if (compositionError) throw compositionError;
  if (!compositionRow) return null;

  const { data: itemRows, error: itemsError } = await client
    .from("composition_items")
    .select("slot_index, position, item_id")
    .eq("composition_id", compositionId)
    .order("slot_index", { ascending: true })
    .order("position", { ascending: true });
  if (itemsError) throw itemsError;

  const slots: string[][] = Array.from({ length: SLOT_COUNT }, () => []);
  for (const row of itemRows) {
    slots[row.slot_index].push(row.item_id);
  }

  return {
    billingEmail: compositionRow.billing_email,
    locale: compositionRow.locale,
    quizMode: compositionRow.quiz_mode,
    requestedDifficulty: compositionRow.requested_difficulty,
    seed: compositionRow.seed,
    composition: { slots },
  };
}
