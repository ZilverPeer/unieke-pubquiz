import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createSupabaseClient, resolveLocalStackConfig } from "@/repository";
import { loadSubsubcategoryOptions } from "@/repository/admin/items";
import { ItemForm } from "../item-form";

export default async function NewItemPage() {
  const t = await getTranslations("items");
  const client = createSupabaseClient(resolveLocalStackConfig());
  const subsubcategoryOptions = await loadSubsubcategoryOptions(client, "nl");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("form.newTitle")}</h1>
        <Link href="/admin/items">{t("form.backToList")}</Link>
      </div>
      <ItemForm mode="create" subsubcategoryOptions={subsubcategoryOptions} />
    </div>
  );
}
