/**
 * Excluded-item lookup and Composition persistence. Private helper for
 * src/repository/index.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompositionRecord } from "@/domain";
import type { Database } from "./database.types";

export async function loadExcludedItemIds(
  client: SupabaseClient<Database>,
  billingEmail: string,
): Promise<Set<string>> {
  const { data, error } = await client
    .from("composition_items")
    .select("item_id, compositions!inner(billing_email)")
    .eq("compositions.billing_email", billingEmail);

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
      billing_email: record.billingEmail,
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
