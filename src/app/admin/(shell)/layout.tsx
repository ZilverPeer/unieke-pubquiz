import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import Link from "next/link";
import { requireOperator } from "@/admin/auth/session";
import { setLocale } from "./locale/actions";
import { signOut } from "../login/actions";

// The (shell) route group (spec 4, ticket #85 fix round 1) keeps this guard
// off /admin/login: requireOperator() below redirects to /admin/login on no
// session, so if this layout also wrapped the login page itself, that
// redirect would target its own route and loop forever. Route groups don't
// affect the URL, so /admin, /admin/categories etc. are unchanged; only
// /admin/login sits outside this group now (src/app/admin/login/layout.tsx).
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const locale = await getLocale();
  const messages = await getMessages();
  const operator = await requireOperator();
  const t = await getTranslations("admin");

  if (!operator) {
    return (
      <NextIntlClientProvider locale={locale} messages={messages}>
        <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-2 p-6">
          <h1 className="text-xl font-semibold">{t("refused.title")}</h1>
          <p>{t("refused.message")}</p>
        </main>
      </NextIntlClientProvider>
    );
  }

  const otherLocale = locale === "nl" ? "en" : "nl";

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <div className="flex min-h-screen flex-col">
        <header className="flex items-center justify-between border-b px-6 py-3">
          <nav className="flex gap-4">
            <Link href="/admin/categories">{t("nav.categories")}</Link>
            <Link href="/admin/items">{t("nav.items")}</Link>
            <Link href="/admin/coverage">{t("nav.coverage")}</Link>
            <Link href="/admin/orders">{t("nav.orders")}</Link>
          </nav>
          <div className="flex items-center gap-3">
            <form action={setLocale}>
              <input type="hidden" name="locale" value={otherLocale} />
              <button type="submit">{otherLocale === "nl" ? t("locale.dutch") : t("locale.english")}</button>
            </form>
            <form action={signOut}>
              <button type="submit">{t("nav.signOut")}</button>
            </form>
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </NextIntlClientProvider>
  );
}
