/**
 * Content repository: the only module that talks to Postgres and Storage
 * (via Supabase). Loads the sampleable Item pool for a Locale, loads a
 * billing email's excluded Item ids (the no-repeat rule), and persists a
 * Composition. May import only src/domain and supabase-js.
 * See README.md.
 */
import type { CompositionRecord, Locale } from "@/domain";
import { createSupabaseClient, type RepositoryConfig } from "./client";
import {
  loadExcludedItemIds as loadExcludedItemIdsImpl,
  persistComposition as persistCompositionImpl,
} from "./compositions";
import { loadPool as loadPoolImpl } from "./pool";
import { downloadFromBucket } from "./storage";
import type { PoolEntry } from "./types";

export type { RepositoryConfig } from "./client";
export type { ItemTranslation, PoolEntry } from "./types";
// Local-dev only: resolves the local Supabase stack's connection config for
// dev scripts and integration tests. See local-stack-config.ts.
export { resolveLocalStackConfig } from "./local-stack-config";

export interface ContentRepository {
  loadPool(locale: Locale): Promise<PoolEntry[]>;
  loadExcludedItemIds(billingEmail: string): Promise<Set<string>>;
  persistComposition(record: CompositionRecord): Promise<{ compositionId: string }>;
  downloadPicture(storagePath: string): Promise<Uint8Array>;
  downloadMusicClip(storagePath: string): Promise<Uint8Array>;
}

export function createRepository(config: RepositoryConfig): ContentRepository {
  const client = createSupabaseClient(config);

  return {
    loadPool: (locale) => loadPoolImpl(client, locale),
    loadExcludedItemIds: (billingEmail) => loadExcludedItemIdsImpl(client, billingEmail),
    persistComposition: (record) => persistCompositionImpl(client, record),
    downloadPicture: (storagePath) => downloadFromBucket(client, "pictures", storagePath),
    downloadMusicClip: (storagePath) => downloadFromBucket(client, "music-clips", storagePath),
  };
}
