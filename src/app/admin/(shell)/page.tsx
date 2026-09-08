import { getTranslations } from "next-intl/server";

export default async function AdminHomePage() {
  const t = await getTranslations("admin.nav");
  return <p>{t("welcome")}</p>;
}
