import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ImportNav } from "../import-nav";
import { PictureImportForm } from "./picture-import-form";

export default async function ImportPictureItemsPage() {
  const t = await getTranslations("pictureImport");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <Link href="/admin/items">{t("form.backToList")}</Link>
      </div>

      <ImportNav />

      <p>{t("intro")}</p>

      <p>
        <Link href="/admin/items/import/pictures/template" className="underline">
          {t("templateLink")}
        </Link>
      </p>
      <p className="text-gray-500">{t("templateHint")}</p>

      <PictureImportForm />
    </div>
  );
}
