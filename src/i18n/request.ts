/**
 * next-intl request config for the admin shell (spec 4, ticket #85):
 * locale-as-data, cookie-backed, no URL-based locale routing (the app has
 * no other locale-aware area). Cookie name and default match the locale
 * switch action, src/app/admin/locale/actions.ts.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

/**
 * One JSON file per top-level namespace under `messages/<locale>/`
 * (`admin.json` -> namespace `admin`, `categories.json` -> `categories`,
 * ...), merged at request time. Tickets that add a page add their own file
 * instead of editing one shared file, so parallel admin tickets do not
 * conflict on the message files (spec 4 wave pin). Both Locales must carry
 * the same file names and key sets.
 */
async function loadMessages(locale: string): Promise<Record<string, unknown>> {
  const dir = join(process.cwd(), "messages", locale);
  const files = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  const messages: Record<string, unknown> = {};
  for (const file of files) {
    messages[file.slice(0, -".json".length)] = JSON.parse(await readFile(join(dir, file), "utf8"));
  }
  return messages;
}

export const ADMIN_LOCALE_COOKIE = "pubquiz_admin_locale";
export const DEFAULT_ADMIN_LOCALE = "nl";

export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieLocale = store.get(ADMIN_LOCALE_COOKIE)?.value;
  const locale = cookieLocale === "en" ? "en" : DEFAULT_ADMIN_LOCALE;
  const messages = await loadMessages(locale);

  return { locale, messages };
});
