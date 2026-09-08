import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { Difficulty, ItemKind, Locale } from "@/domain";
import { createSupabaseClient, resolveLocalStackConfig } from "@/repository";
import { listItems, loadSubsubcategoryOptions } from "@/repository/admin/items";

const PAGE_SIZE = 25;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function asKind(value: string | undefined): ItemKind | undefined {
  return value === "text" || value === "picture" || value === "music" ? value : undefined;
}

function asDifficulty(value: string | undefined): Difficulty | undefined {
  return value === "easy" || value === "medium" || value === "hard" ? value : undefined;
}

function asLocale(value: string | undefined): Locale | undefined {
  return value === "nl" || value === "en" ? value : undefined;
}

export default async function ItemsPage({ searchParams }: PageProps<"/admin/items">) {
  const params = (await searchParams) ?? {};
  const t = await getTranslations("items");

  const query = first(params.q)?.trim() || undefined;
  const kind = asKind(first(params.kind));
  const difficulty = asDifficulty(first(params.difficulty));
  const missingLocale = asLocale(first(params.missingLocale));
  const categoryId = first(params.categoryId) || undefined;
  const subcategoryId = first(params.subcategoryId) || undefined;
  const subsubcategoryId = first(params.subsubcategoryId) || undefined;
  const includeArchived = first(params.includeArchived) === "1";
  const page = Math.max(1, Number(first(params.page) ?? "1") || 1);

  const client = createSupabaseClient(resolveLocalStackConfig());
  const [{ items, total }, subsubcategoryOptions] = await Promise.all([
    listItems(client, {
      locale: "nl",
      query,
      kind,
      difficulty,
      missingLocale,
      categoryId,
      subcategoryId,
      subsubcategoryId,
      includeArchived,
      page,
      pageSize: PAGE_SIZE,
    }),
    loadSubsubcategoryOptions(client, "nl"),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <Link href="/admin/items/new" className="border px-3 py-1">
          {t("list.new")}
        </Link>
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span>{t("list.search")}</span>
          <input
            type="text"
            name="q"
            defaultValue={query ?? ""}
            placeholder={t("list.searchPlaceholder")}
            className="border px-2 py-1"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span>{t("list.kind")}</span>
          <select name="kind" defaultValue={kind ?? ""} className="border px-2 py-1">
            <option value="">{t("list.kindAll")}</option>
            <option value="text">{t("list.kindText")}</option>
            <option value="picture">{t("list.kindPicture")}</option>
            <option value="music">{t("list.kindMusic")}</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span>{t("list.subsubcategory")}</span>
          <select name="subsubcategoryId" defaultValue={subsubcategoryId ?? ""} className="border px-2 py-1">
            <option value="">{t("list.subsubcategoryAll")}</option>
            {subsubcategoryOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.path}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span>{t("list.difficulty")}</span>
          <select name="difficulty" defaultValue={difficulty ?? ""} className="border px-2 py-1">
            <option value="">{t("list.difficultyAll")}</option>
            <option value="easy">{t("form.difficultyEasy")}</option>
            <option value="medium">{t("form.difficultyMedium")}</option>
            <option value="hard">{t("form.difficultyHard")}</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span>{t("list.missingLocale")}</span>
          <select name="missingLocale" defaultValue={missingLocale ?? ""} className="border px-2 py-1">
            <option value="">{t("list.missingLocaleAll")}</option>
            <option value="nl">{t("list.missingLocaleNl")}</option>
            <option value="en">{t("list.missingLocaleEn")}</option>
          </select>
        </label>

        <label className="flex items-center gap-2">
          <input type="checkbox" name="includeArchived" value="1" defaultChecked={includeArchived} />
          <span>{t("list.includeArchived")}</span>
        </label>

        <button type="submit" className="border px-3 py-1">
          {t("list.apply")}
        </button>
      </form>

      {items.length === 0 ? (
        <p>{t("list.empty")}</p>
      ) : (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b">
              <th className="py-2">{t("list.columnQuestion")}</th>
              <th className="py-2">{t("list.columnAnswer")}</th>
              <th className="py-2">{t("list.columnCategory")}</th>
              <th className="py-2">{t("list.columnDifficulty")}</th>
              <th className="py-2">{t("list.columnLocales")}</th>
              <th className="py-2">{t("list.columnActions")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b">
                <td className="py-2">{item.question ?? "—"}</td>
                <td className="py-2">{item.answer ?? "—"}</td>
                <td className="py-2">
                  {item.categoryName} / {item.subcategoryName} / {item.subsubcategoryName}
                </td>
                <td className="py-2">{item.difficulty}</td>
                <td className="py-2">
                  {(["nl", "en"] as const).map((locale) => (
                    <span key={locale} className="mr-2">
                      {locale}
                      {!item.locales.includes(locale) ? ` (${t("list.missingMark")})` : ""}
                    </span>
                  ))}
                </td>
                <td className="py-2">
                  <Link href={`/admin/items/${item.id}`}>{t("list.edit")}</Link>
                  {item.archivedAt ? <span className="ml-2 text-gray-500">{t("list.archived")}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <nav className="flex items-center gap-4">
        {page > 1 ? (
          <Link href={{ pathname: "/admin/items", query: { ...params, page: String(page - 1) } }}>
            {t("list.previousPage")}
          </Link>
        ) : null}
        <span>{t("list.pageStatus", { page, totalPages })}</span>
        {page < totalPages ? (
          <Link href={{ pathname: "/admin/items", query: { ...params, page: String(page + 1) } }}>
            {t("list.nextPage")}
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
