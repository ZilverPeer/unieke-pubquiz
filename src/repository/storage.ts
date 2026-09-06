/**
 * Storage downloads for Picture and Music Item files, and uploads/downloads/
 * deletes for the `deliverables` bucket (spec #36, tickets #40/#42). Private
 * helper for src/repository/index.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export async function downloadFromBucket(
  client: SupabaseClient<Database>,
  bucket: "pictures" | "music-clips" | "deliverables",
  storagePath: string,
): Promise<Uint8Array> {
  const { data, error } = await client.storage.from(bucket).download(storagePath);
  if (error) throw error;

  const buffer = await data.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Deletes objects from the private `deliverables` bucket (ticket #42's
 * pruning job). A no-op for an empty list; deleting a path that's already
 * gone is not an error (Supabase Storage's `remove` simply omits it from the
 * result), which is what makes the pruning job safe to run repeatedly.
 */
export async function deleteFromDeliverablesBucket(
  client: SupabaseClient<Database>,
  storagePaths: readonly string[],
): Promise<void> {
  if (storagePaths.length === 0) return;

  const { error } = await client.storage.from("deliverables").remove(storagePaths as string[]);
  if (error) throw error;
}

/**
 * Uploads one Deliverable to the private `deliverables` bucket, at
 * `storagePath` (the worker uses `<quiz id>/<file name>`, see
 * src/domain/orders.ts's DELIVERABLE_FILES). `upsert: true` so a retried or
 * re-rendered Quiz overwrites its own prior files at the same path rather
 * than failing on conflict.
 */
export async function uploadToDeliverablesBucket(
  client: SupabaseClient<Database>,
  storagePath: string,
  data: Uint8Array,
  contentType: string,
): Promise<void> {
  const { error } = await client.storage.from("deliverables").upload(storagePath, data, {
    contentType,
    upsert: true,
  });
  if (error) throw error;
}
