/**
 * Supabase client construction. Private to src/repository -- nothing outside
 * this module talks to supabase-js directly.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export interface RepositoryConfig {
  url: string;
  serviceRoleKey: string;
}

export function createSupabaseClient(config: RepositoryConfig): SupabaseClient<Database> {
  return createClient<Database>(config.url, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
