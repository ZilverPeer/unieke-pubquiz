import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createSupabaseClient, resolveLocalStackConfig } from "@/repository";
import { getItem, loadSubsubcategoryOptions } from "@/repository/admin/items";
import { createMusicSignedUrl } from "@/repository/admin/music-items";
import { ItemForm, type ItemFormInitialValues } from "../item-form";
import { MusicFields } from "../music-fields";

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
      included: item.translations.nl !== undefined,
    },
    en: {
      question: item.translations.en?.question ?? "",
      answer: item.translations.en?.answer ?? "",
      fact: item.translations.en?.fact ?? "",
      included: item.translations.en !== undefined,
    },
  };

  let kindFields: React.ReactNode;
  if (item.kind === "music" && item.music) {
    const existingClipUrl = await createMusicSignedUrl(client, item.music.storagePath);
    kindFields = (
      <MusicFields
        mode="edit"
        errors={{}}
        existingClipUrl={existingClipUrl}
        initialValues={{
          artist: item.music.artist,
          title: item.music.title,
          startSeconds: "",
          endSeconds: "",
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("form.editTitle")}</h1>
        <Link href="/admin/items">{t("form.backToList")}</Link>
      </div>
      <ItemForm
        mode="edit"
        itemId={id}
        kind={item.kind}
        subsubcategoryOptions={subsubcategoryOptions}
        initialValues={initialValues}
        kindFields={kindFields}
      />
    </div>
  );
}
