import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ItemKind } from "@/domain";
import { createSupabaseClient, resolveLocalStackConfig } from "@/repository";
import { loadSubsubcategoryOptions } from "@/repository/admin/items";
import { ItemForm } from "../item-form";
import { MusicFields } from "../music-fields";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function asKind(value: string | undefined): ItemKind {
  if (value === undefined || value === "text") return "text";
  if (value === "picture" || value === "music") return value;
  notFound();
}

export default async function NewItemPage({ searchParams }: PageProps<"/admin/items/new">) {
  const params = (await searchParams) ?? {};
  const kind = asKind(first(params.kind));

  const t = await getTranslations("items");
  const client = createSupabaseClient(resolveLocalStackConfig());
  const subsubcategoryOptions = await loadSubsubcategoryOptions(client, "nl");

  const kindFields = kind === "music" ? <MusicFields mode="create" errors={{}} /> : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("form.newTitle")}</h1>
        <Link href="/admin/items">{t("form.backToList")}</Link>
      </div>
      <nav className="flex gap-3 text-sm">
        <Link href="/admin/items/new?kind=text">{t("form.kindLinks.text")}</Link>
        <Link href="/admin/items/new?kind=picture">{t("form.kindLinks.picture")}</Link>
        <Link href="/admin/items/new?kind=music">{t("form.kindLinks.music")}</Link>
      </nav>
      <ItemForm mode="create" kind={kind} subsubcategoryOptions={subsubcategoryOptions} kindFields={kindFields} />
    </div>
  );
}
