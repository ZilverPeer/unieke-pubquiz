/**
 * Category id existence check (spec #36, ticket #39): the webhook parser
 * (src/app/api/webhooks/woocommerce/parse-order.ts) validates a checkout
 * Category pick against real Category ids before accepting it.
 * ContentRepository had no existing way to check whether a Category id
 * exists at all -- this is the smallest read-only query that adds one.
 * Private helper for src/repository/index.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export async function loadCategoryIds(client: SupabaseClient<Database>): Promise<Set<string>> {
  const { data, error } = await client.from("categories").select("id");
  if (error) throw error;
  return new Set((data ?? []).map((row) => String(row.id)));
}
