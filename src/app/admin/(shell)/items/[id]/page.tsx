import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createSupabaseClient, resolveLocalStackConfig } from "@/repository";
import { getItem, loadSubsubcategoryOptions } from "@/repository/admin/items";
import { createMusicSignedUrl } from "@/repository/admin/music-items";
import { createPictureSignedUrl } from "@/repository/admin/picture-items";
import { ItemForm, type ItemFormInitialValues, type ItemFormKindProps } from "../item-form";

export default async function EditItemPage({ params }: PageProps<"/admin/items/[id]">) {
  const { id } = await params;

  const client = createSupabaseClient(resolveLocalStackConfig());
  const [item, subsubcategoryOptions] = await Promise.all([
    getItem(client, id),
    loadSubsubcategoryOptions(client, "nl"),
  ]);

  if (!item) {
    notFound();
  }

  // Per-kind page title (items-kind-common brief; flagged by the Spec
  // reviewer of PR 115 -- pictureItems.form.editTitle existed but nothing
  // read it).
  const [t, tPicture, tMusic] = await Promise.all([
    getTranslations("items"),
    getTranslations("pictureItems"),
    getTranslations("musicItems"),
  ]);
  const title =
    item.kind === "picture" ? tPicture("form.editTitle") : item.kind === "music" ? tMusic("form.editTitle") : t("form.editTitle");

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

  // Kind-specific fields are rendered by ItemForm itself, from `kindProps`
  // (serializable initial values only) -- see item-form.tsx's docblock for
  // why (fix round on PR 116).
  let kindProps: ItemFormKindProps | undefined;
  if (item.kind === "music" && item.music) {
    const clipUrl = await createMusicSignedUrl(client, item.music.storagePath);
    kindProps = {
      artist: item.music.artist,
      title: item.music.title,
      clipUrl,
    };
  } else if (item.kind === "picture") {
    const imageUrl = item.pictureStoragePath ? await createPictureSignedUrl(client, item.pictureStoragePath) : undefined;
    kindProps = { imageUrl };
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{title}</h1>
        <Link href="/admin/items">{t("form.backToList")}</Link>
      </div>
      <ItemForm
        mode="edit"
        itemId={id}
        kind={item.kind}
        subsubcategoryOptions={subsubcategoryOptions}
        initialValues={initialValues}
        kindProps={kindProps}
      />
    </div>
  );
}
