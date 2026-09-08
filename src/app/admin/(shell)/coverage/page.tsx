import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { Locale, RequestedDifficulty } from "@/domain";
import { loadCoverage } from "./data";

const DIFFICULTIES: readonly RequestedDifficulty[] = ["easy", "medium", "hard", "mixed"];

function resolveDataLocale(value: string | string[] | undefined): Locale {
  return value === "en" ? "en" : "nl";
}

// The data Locale (which pool is shown) is a GET parameter, independent of
// the UI Locale (how Erik reads the page, from the shell's cookie switch) --
// see ticket #92.
export default async function CoveragePage(props: PageProps<"/admin/coverage">) {
  const searchParams = await props.searchParams;
  const dataLocale = resolveDataLocale(searchParams.locale);

  const t = await getTranslations("coverage");
  const categories = await loadCoverage(dataLocale);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-gray-600">{t("intro")}</p>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">{t("dataLocale.label")}</span>
        <Link
          href="?locale=nl"
          aria-current={dataLocale === "nl" ? "page" : undefined}
          className={dataLocale === "nl" ? "font-semibold underline" : "underline"}
        >
          {t("dataLocale.nl")}
        </Link>
        <Link
          href="?locale=en"
          aria-current={dataLocale === "en" ? "page" : undefined}
          className={dataLocale === "en" ? "font-semibold underline" : "underline"}
        >
          {t("dataLocale.en")}
        </Link>
      </div>

      {categories.length === 0 && <p>{t("empty")}</p>}

      {categories.map((category) => (
        <section key={category.categoryId}>
          <h2 className="mb-2 text-lg font-semibold">{category.categoryName}</h2>
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                <th className="border px-3 py-1 text-left">{t("table.kindHeader")}</th>
                {DIFFICULTIES.map((difficulty) => (
                  <th key={difficulty} className="border px-3 py-1 text-left">
                    {t(`table.difficulty.${difficulty}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {category.rows.map((row) => (
                <tr key={row.kind}>
                  <th scope="row" className="border px-3 py-1 text-left font-normal">
                    {t(`table.kind.${row.kind}`)}
                  </th>
                  {DIFFICULTIES.map((difficulty) => {
                    const cell = row.cells[difficulty];
                    return (
                      <td
                        key={difficulty}
                        className={`border px-3 py-1 ${cell.fits ? "" : "text-red-600 font-semibold"}`}
                      >
                        {cell.eligibleItems}
                        {!cell.fits && <span> ({t("cell.doesNotFit")})</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
