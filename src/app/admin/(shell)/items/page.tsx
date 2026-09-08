import { getTranslations } from "next-intl/server";

export default async function ItemsPage() {
  const t = await getTranslations("admin.nav");
  return <h1 className="text-xl font-semibold">{t("items")}</h1>;
}
