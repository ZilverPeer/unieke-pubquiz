import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ImportForm } from "./import-form";

export default async function ImportItemsPage() {
  const t = await getTranslations("itemsImport");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <Link href="/admin/items">{t("form.backToList")}</Link>
      </div>

      <p>{t("intro")}</p>

      <p>
        <Link href="/admin/items/import/template" className="underline">
          {t("templateLink")}
        </Link>
      </p>
      <p className="text-gray-500">{t("templateHint")}</p>

      <ImportForm />
    </div>
  );
}
