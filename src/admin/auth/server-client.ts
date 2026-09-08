/**
 * SSR Supabase client for the admin auth path (spec 4, ticket #85):
 * cookie-backed session, built from the anon key only -- never the service
 * role key, which stays inside src/repository/client.ts and is never sent
 * to a browser-reachable code path. Used by server actions and Server
 * Components under src/app/admin; the proxy (src/proxy.ts) builds its own
 * client the same way because it runs before Next's request lifecycle
 * gives it access to next/headers.
 */
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set (see .env.example)`);
  }
  return value;
}

export async function createAdminSupabaseClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component render, where next/headers's
            // cookies() is read-only. Harmless here: the proxy already
            // refreshes the session cookie on every request that reaches
            // it (src/proxy.ts), so a Server Component never needs to be
            // the one that writes it back.
          }
        },
      },
    },
  );
}
