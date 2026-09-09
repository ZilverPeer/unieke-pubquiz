import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createSupabaseClient, resolveLocalStackConfig } from "@/repository";
import { getItem, loadSubsubcategoryOptions } from "@/repository/admin/items";
import { ItemForm, type ItemFormInitialValues } from "../item-form";
import { ItemLifecycle } from "../item-lifecycle";

export default async function EditItemPage({ params }: PageProps<"/admin/items/[id]">) {
  const { id } = await params;
  const t = await getTranslations("items");

  const client = createSupabaseClient(resolveLocalStackConfig());
  const [item, subsubcategoryOptions] = await Promise.all([
    getItem(client, id),
    loadSubsubcategoryOptions(client, "nl"),
  ]);

  if (!item) {
    notFound();
  }

  const initialValues: ItemFormInitialValues = {
    subsubcategoryId: item.subsubcategoryId,
    difficulty: item.difficulty,
    nl: {
      question: item.translations.nl?.question ?? "",
      answer: item.translations.nl?.answer ?? "",
      fact: item.translations.nl?.fact ?? "",
    },
    en: {
      question: item.translations.en?.question ?? "",
      answer: item.translations.en?.answer ?? "",
      fact: item.translations.en?.fact ?? "",
    },
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("form.editTitle")}</h1>
        <Link href="/admin/items">{t("form.backToList")}</Link>
      </div>
      <ItemLifecycle item={item} locale="nl" />
      <ItemForm mode="edit" itemId={id} subsubcategoryOptions={subsubcategoryOptions} initialValues={initialValues} />
    </div>
  );
}
