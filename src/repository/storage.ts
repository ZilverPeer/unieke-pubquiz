/**
 * Storage downloads for Picture and Music Item files. Private helper for
 * src/repository/index.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export async function downloadFromBucket(
  client: SupabaseClient<Database>,
  bucket: "pictures" | "music-clips",
  storagePath: string,
): Promise<Uint8Array> {
  const { data, error } = await client.storage.from(bucket).download(storagePath);
  if (error) throw error;

  const buffer = await data.arrayBuffer();
  return new Uint8Array(buffer);
}
