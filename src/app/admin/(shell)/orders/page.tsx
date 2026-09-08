import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { classifyQuery } from "@/admin/orders/classify";
import { findOrders } from "@/repository/admin/orders";
import { createSupabaseClient, resolveLocalStackConfig } from "@/repository";
import type { OrderRecord } from "@/domain";

/**
 * Orders search (spec 4, ticket #93): a GET form, not a server action --
 * this is a read, so the query lives in the URL like any other search page
 * (bookmarkable, no client JS needed). The single input accepts either a
 * WooCommerce order number or a billing email; classifyQuery decides which.
 */
export default async function OrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  const t = await getTranslations("orders");
  const params = await searchParams;
  const rawQuery = params?.query;
  const query = typeof rawQuery === "string" ? rawQuery : undefined;

  let orders: OrderRecord[] = [];
  let invalid = false;

  if (query !== undefined) {
    const classification = classifyQuery(query);
    if (classification.kind === "invalid") {
      invalid = true;
    } else {
      const client = createSupabaseClient(resolveLocalStackConfig());
      orders = await findOrders(client, { query });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{t("search.title")}</h1>

      <form method="GET" className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1">
          <span>{t("search.label")}</span>
          <input
            type="text"
            name="query"
            defaultValue={query ?? ""}
            placeholder={t("search.placeholder")}
            className="border px-2 py-1"
          />
        </label>
        <button type="submit" className="border px-3 py-1">
          {t("search.submit")}
        </button>
      </form>

      {invalid && <p className="text-red-600">{t("search.invalid")}</p>}

      {query !== undefined && !invalid && orders.length === 0 && <p>{t("search.empty")}</p>}

      {orders.length > 0 && (
        <table className="border-collapse">
          <caption className="sr-only">{t("search.results")}</caption>
          <thead>
            <tr>
              <th className="border px-2 py-1 text-left">{t("search.orderNumber")}</th>
              <th className="border px-2 py-1 text-left">{t("search.email")}</th>
              <th className="border px-2 py-1 text-left">{t("search.view")}</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td className="border px-2 py-1">{order.wooOrderId}</td>
                <td className="border px-2 py-1">{order.billingEmail}</td>
                <td className="border px-2 py-1">
                  <Link href={`/admin/orders/${order.id}`} className="underline">
                    {t("search.view")}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
