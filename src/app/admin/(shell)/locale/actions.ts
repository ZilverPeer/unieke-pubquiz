"use server";
/**
 * Locale switch (spec 4, ticket #85): sets the cookie src/i18n/request.ts
 * reads and revalidates the admin layout so the switch takes effect on the
 * same navigation, not just after a later reload.
 */
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { ADMIN_LOCALE_COOKIE } from "@/i18n/request";

export async function setLocale(formData: FormData): Promise<void> {
  const locale = formData.get("locale");
  if (locale !== "nl" && locale !== "en") return;

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });

  revalidatePath("/admin", "layout");
}
