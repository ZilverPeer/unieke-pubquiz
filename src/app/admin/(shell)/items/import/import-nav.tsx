/**
 * Small nav between the two bulk-import kinds (spec 4, ticket #95 decision
 * "Navigation"): the Text import page and the Picture import page each show
 * this, so an operator on either can reach the other without going back to
 * the Items list. A server component (both pages that render it are server
 * components); keys live in itemsImport.json ("kindLinks.text"/
 * "kindLinks.picture") since the Text import namespace already existed and
 * this nav is shared, not duplicated per namespace.
 */
import Link from "next/link";
import { getTranslations } from "next-intl/server";

export async function ImportNav() {
  const t = await getTranslations("itemsImport");

  return (
    <nav className="flex gap-4 text-sm">
      <Link href="/admin/items/import" className="underline">
        {t("kindLinks.text")}
      </Link>
      <Link href="/admin/items/import/pictures" className="underline">
        {t("kindLinks.picture")}
      </Link>
    </nav>
  );
}
