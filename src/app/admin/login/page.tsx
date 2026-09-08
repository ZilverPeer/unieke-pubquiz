import { getTranslations } from "next-intl/server";
import { login } from "./actions";

export default async function LoginPage({ searchParams }: PageProps<"/admin/login">) {
  const t = await getTranslations("admin.login");
  const params = await searchParams;
  const hasError = params?.error === "1";

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      {hasError && <p className="text-red-600">{t("error")}</p>}
      <form action={login} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span>{t("email")}</span>
          <input type="email" name="email" required autoComplete="email" className="border px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          <span>{t("password")}</span>
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            className="border px-2 py-1"
          />
        </label>
        <button type="submit" className="border px-3 py-1">
          {t("submit")}
        </button>
      </form>
    </main>
  );
}
