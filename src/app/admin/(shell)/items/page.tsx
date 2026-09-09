import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { Difficulty, ItemKind, Locale } from "@/domain";
import { createSupabaseClient, resolveLocalStackConfig } from "@/repository";
import { listItems, loadCategoryOptions, loadSubcategoryOptions, loadSubsubcategoryOptions } from "@/repository/admin/items";
import { archiveItem, deleteItem, unarchiveItem } from "./actions";

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

const DIFFICULTY_KEYS: Record<Difficulty, "form.difficultyEasy" | "form.difficultyMedium" | "form.difficultyHard"> = {
  easy: "form.difficultyEasy",
  medium: "form.difficultyMedium",
  hard: "form.difficultyHard",
};

export default async function ItemsPage({ searchParams }: PageProps<"/admin/items">) {
  const params = (await searchParams) ?? {};
  const t = await getTranslations("items");
  const tl = await getTranslations("itemLifecycle");

  const query = first(params.q)?.trim() || undefined;
  const kind = asKind(first(params.kind));
  const difficulty = asDifficulty(first(params.difficulty));
  const missingLocale = asLocale(first(params.missingLocale));
  const categoryId = first(params.categoryId) || undefined;
  const subcategoryId = first(params.subcategoryId) || undefined;
  const subsubcategoryId = first(params.subsubcategoryId) || undefined;
  const includeArchived = first(params.includeArchived) === "1";
  const page = Math.max(1, Number(first(params.page) ?? "1") || 1);
  const lifecycleError = first(params.error);

  // The current filters as a query string, so a lifecycle action's redirect
  // (used only to attach ?error=inUse -- see deleteRow below) lands back on
  // this same filtered/paginated view rather than resetting it.
  function buildListUrl(overrides: Record<string, string | undefined> = {}): string {
    const current: Record<string, string | undefined> = {
      q: query,
      kind,
      difficulty,
      missingLocale,
      categoryId,
      subcategoryId,
      subsubcategoryId,
      includeArchived: includeArchived ? "1" : undefined,
      page: page > 1 ? String(page) : undefined,
    };
    const merged = { ...current, ...overrides };
    const usp = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value) usp.set(key, value);
    }
    const qs = usp.toString();
    return qs ? `/admin/items?${qs}` : "/admin/items";
  }

  const client = createSupabaseClient(resolveLocalStackConfig());
  const [{ items, total }, categoryOptions, subcategoryOptions, subsubcategoryOptions] = await Promise.all([
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
    loadCategoryOptions(client, "nl"),
    loadSubcategoryOptions(client, "nl", categoryId),
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

      {lifecycleError === "inUse" ? <p className="text-red-600">{tl("errors.inUse")}</p> : null}

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
          <span>{t("list.category")}</span>
          <select name="categoryId" defaultValue={categoryId ?? ""} className="border px-2 py-1">
            <option value="">{t("list.categoryAll")}</option>
            {categoryOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span>{t("list.subcategory")}</span>
          <select name="subcategoryId" defaultValue={subcategoryId ?? ""} className="border px-2 py-1">
            <option value="">{t("list.subcategoryAll")}</option>
            {subcategoryOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
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
            {items.map((item) => {
              // Inline Server Functions closing over this row's id, not
              // `archiveItem.bind(null, item.id)` -- see item-lifecycle.tsx's
              // docblock for why a bound two-parameter action would receive
              // the form's FormData in its `deps` slot at runtime.
              async function archiveRow() {
                "use server";
                await archiveItem(item.id);
              }

              async function unarchiveRow() {
                "use server";
                await unarchiveItem(item.id);
              }

              async function deleteRow() {
                "use server";
                const result = await deleteItem(item.id);
                if (!result.ok) redirect(buildListUrl({ error: "inUse" }));
              }

              return (
                <tr key={item.id} className="border-b">
                  <td className="py-2">{item.question ?? "—"}</td>
                  <td className="py-2">{item.answer ?? "—"}</td>
                  <td className="py-2">
                    {item.categoryName} / {item.subcategoryName} / {item.subsubcategoryName}
                  </td>
                  <td className="py-2">{t(DIFFICULTY_KEYS[item.difficulty])}</td>
                  <td className="py-2">
                    {(["nl", "en"] as const).map((locale) => (
                      <span key={locale} className="mr-2">
                        {locale}
                        {!item.locales.includes(locale) ? ` (${t("list.missingMark")})` : ""}
                      </span>
                    ))}
                  </td>
                  <td className="py-2 flex flex-wrap items-center gap-2">
                    <Link href={`/admin/items/${item.id}`}>{t("list.edit")}</Link>
                    {item.archivedAt ? (
                      <form action={unarchiveRow}>
                        <button type="submit" className="border px-2 py-1">
                          {tl("actions.unarchive")}
                        </button>
                      </form>
                    ) : (
                      <form action={archiveRow}>
                        <button type="submit" className="border px-2 py-1">
                          {tl("actions.archive")}
                        </button>
                      </form>
                    )}
                    {!item.archivedAt && item.usageCount === 0 ? (
                      <form action={deleteRow}>
                        <button type="submit" className="border px-2 py-1">
                          {tl("actions.delete")}
                        </button>
                      </form>
                    ) : null}
                    {item.archivedAt ? <span className="ml-2 text-gray-500">{t("list.archived")}</span> : null}
                  </td>
                </tr>
              );
            })}
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
