/**
 * Archive/unarchive/delete block for the Item edit page (spec 4, ticket
 * #89). Rendered above the form by [id]/page.tsx. A small server component
 * of its own rather than JSX inline in that page, so the edit page's only
 * change is one import and one JSX line (ticket brief).
 *
 * Each button is a plain <form> wired to a Server Function defined inline
 * here (not `archiveItem.bind(null, item.id)`): Next's own docs
 * (node_modules/next/dist/docs/01-app/02-guides/forms.md, "Passing
 * additional arguments") show that a form calling a bound action receives
 * the submitted FormData as the NEXT positional argument after the bound
 * ones -- for a two-parameter action (id, deps), that FormData would land
 * in `deps` at runtime and break deps.assertOperator()/revalidateItems for
 * every real click. The inline closures below take the id from the
 * component's own closure instead and call the exported, deps-testable
 * action with just that id, so `deps` keeps its default in production.
 */
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { Locale } from "@/domain";
import type { ItemDetail } from "@/repository/admin/items";
import { archiveItem, deleteItem, unarchiveItem } from "./actions";

function formatDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleString(locale === "nl" ? "nl-NL" : "en-GB");
}

export async function ItemLifecycle({
  item,
  locale,
  error,
}: {
  item: ItemDetail;
  locale: Locale;
  /** Set when the edit page's own `?error=inUse` search param is present -- see deleteAction below. */
  error?: boolean;
}) {
  const t = await getTranslations("itemLifecycle");

  async function archiveAction() {
    "use server";
    await archiveItem(item.id);
  }

  async function unarchiveAction() {
    "use server";
    await unarchiveItem(item.id);
  }

  async function deleteAction() {
    "use server";
    const result = await deleteItem(item.id);
    if (result.ok) {
      redirect("/admin/items");
    }
    // Refused (ItemInUseError): stay on the edit page and surface the
    // Dutch/English error, the same ?error=inUse pattern the list page uses.
    redirect(`/admin/items/${item.id}?error=inUse`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border p-3">
      {error ? <p className="w-full text-red-600">{t("errors.inUse")}</p> : null}
      {item.archivedAt ? (
        <span className="text-gray-500">{t("archivedAt", { date: formatDate(item.archivedAt, locale) })}</span>
      ) : null}

      {item.archivedAt ? (
        <form action={unarchiveAction}>
          <button type="submit" className="border px-3 py-1">
            {t("actions.unarchive")}
          </button>
        </form>
      ) : (
        <form action={archiveAction}>
          <button type="submit" className="border px-3 py-1">
            {t("actions.archive")}
          </button>
        </form>
      )}

      {!item.archivedAt && item.usageCount === 0 ? (
        <form action={deleteAction}>
          <button type="submit" className="border px-3 py-1">
            {t("actions.delete")}
          </button>
        </form>
      ) : null}
    </div>
  );
}
