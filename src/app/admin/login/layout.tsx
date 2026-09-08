import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

// Deliberately outside the (shell) route group (../(shell)/layout.tsx):
// that layout calls requireOperator(), which redirects to /admin/login on
// no session -- if it also wrapped this page, that redirect would target
// itself and loop forever (spec 4, ticket #85 fix round 1). This layout
// only provides next-intl's messages, no auth guard.
export default async function AdminLoginLayout({ children }: LayoutProps<"/admin/login">) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
