/**
 * Small nav between the three bulk-import kinds (spec 4, ticket #95
 * decision "Navigation", extended for Music in ticket #96): the Text,
 * Picture and Music import pages each show this, so an operator on any one
 * can reach the others without going back to the Items list. A server
 * component (every page that renders it is a server component); keys live
 * in itemsImport.json ("kindLinks.text"/"kindLinks.picture"/
 * "kindLinks.music") since the Text import namespace already existed and
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
      <Link href="/admin/items/import/music" className="underline">
        {t("kindLinks.music")}
      </Link>
    </nav>
  );
}
