/**
 * next-intl request config for the admin shell (spec 4, ticket #85):
 * locale-as-data, cookie-backed, no URL-based locale routing (the app has
 * no other locale-aware area). Cookie name and default match the locale
 * switch action, src/app/admin/locale/actions.ts.
 */
import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

export const ADMIN_LOCALE_COOKIE = "pubquiz_admin_locale";
export const DEFAULT_ADMIN_LOCALE = "nl";

export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieLocale = store.get(ADMIN_LOCALE_COOKIE)?.value;
  const locale = cookieLocale === "en" ? "en" : DEFAULT_ADMIN_LOCALE;
  const messages = (await import(`../../messages/${locale}.json`)).default;

  return { locale, messages };
});
