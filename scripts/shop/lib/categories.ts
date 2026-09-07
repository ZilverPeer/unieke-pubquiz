/**
 * The Dutch Category names `npm run shop:up` builds the field group's
 * Category dropdowns from (ticket #57), replacing the old hardcoded [1..8]
 * id list in setup-field-group.php -- the dropdowns now follow the seed
 * (and later the admin UI) instead of a number pinned by hand.
 *
 * loadDutchCategories() resolves the local Supabase stack's connection
 * config and reads `categories` joined with `category_translations` for
 * locale `nl`. loadDutchCategoriesFromClient() takes an already-built
 * client so it can be driven by a fake in categories.test.ts without a
 * running stack; loadDutchCategories() is the thin wrapper setup.ts calls,
 * exercised empirically against the real stack per the ticket brief.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseClient, resolveLocalStackConfig } from "../../../src/repository";
import type { Database } from "../../../src/repository/database.types";

export interface DutchCategory {
  id: string;
  name: string;
}

/**
 * Loads every Category's `nl` translation, ordered by id ascending. Throws
 * if the query itself fails, if any Category has no `nl` translation, or if
 * there are zero Categories at all (an empty seed is also an error -- the
 * field group needs at least one Category choice).
 */
export async function loadDutchCategoriesFromClient(
  client: SupabaseClient<Database>,
): Promise<DutchCategory[]> {
  const [categoriesResult, translationsResult] = await Promise.all([
    client.from("categories").select("id"),
    client.from("category_translations").select("category_id, name").eq("locale", "nl"),
  ]);

  if (categoriesResult.error) throw categoriesResult.error;
  if (translationsResult.error) throw translationsResult.error;

  const nameByCategoryId = new Map<string, string>();
  for (const row of (translationsResult.data ?? []) as Array<{ category_id: number; name: string }>) {
    nameByCategoryId.set(String(row.category_id), row.name);
  }

  const categories: DutchCategory[] = [];
  for (const row of (categoriesResult.data ?? []) as Array<{ id: number }>) {
    const id = String(row.id);
    const name = nameByCategoryId.get(id);
    if (name === undefined) {
      throw new Error(`Category #${id} has no "nl" translation in category_translations.`);
    }
    categories.push({ id, name });
  }

  if (categories.length === 0) {
    throw new Error("No Categories found in the Supabase stack (expected at least one seeded Category).");
  }

  categories.sort((a, b) => Number(a.id) - Number(b.id));
  return categories;
}

/**
 * Resolves the local Supabase stack's connection config and loads every
 * Category's `nl` name. Called by setup.ts before any WP-CLI call: a
 * stopped/unreachable stack (or a seed with zero Categories) fails fast
 * here, naming the stack as the cause, rather than surfacing as a
 * confusing WordPress-side error later.
 */
export async function loadDutchCategories(): Promise<DutchCategory[]> {
  let client: SupabaseClient<Database>;
  try {
    client = createSupabaseClient(resolveLocalStackConfig());
  } catch (cause) {
    throw wrapStackError(cause);
  }

  try {
    return await loadDutchCategoriesFromClient(client);
  } catch (cause) {
    throw wrapStackError(cause);
  }
}

/**
 * A safe-to-log summary of whatever loadDutchCategoriesFromClient() or
 * createSupabaseClient() threw. PostgREST/fetch failures (a closed port, a
 * connection refused) surface as plain objects or strings, not `Error`
 * instances -- `String(cause)` on those gives the unhelpful
 * `[object Object]`, so fall back to `JSON.stringify` for anything with its
 * own enumerable properties (a Postgrest error's `message`/`code`, a fetch
 * error's `cause`), and only to `String()` as a last resort.
 */
function describeCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "object" && cause !== null) {
    try {
      return JSON.stringify(cause);
    } catch {
      // fall through
    }
  }
  return String(cause);
}

function wrapStackError(cause: unknown): Error {
  return new Error(
    `Could not load Category names from the local Supabase stack (${describeCause(cause)}). ` +
      `Is it running? Start it with "npx supabase start" (see docs/runbook-local-loop.md).`,
  );
}

/**
 * Base64-encodes the Category list as JSON, for setup-shop.php's third
 * positional `wp eval-file` argument -- avoids shell-quoting a JSON array
 * on Windows (see shop/README.md and setup-shop.php's own docblock).
 */
export function encodeCategoriesForWpCli(categories: DutchCategory[]): string {
  return Buffer.from(JSON.stringify(categories), "utf-8").toString("base64");
}
