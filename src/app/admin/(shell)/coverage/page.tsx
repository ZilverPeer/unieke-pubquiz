import { getTranslations } from "next-intl/server";

export default async function CoveragePage() {
  const t = await getTranslations("admin.nav");
  return <h1 className="text-xl font-semibold">{t("coverage")}</h1>;
}
