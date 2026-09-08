import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { loadOrderDetail } from "@/repository/admin/orders";
import { wooAdminOrderUrl } from "@/admin/orders/woo-url";
import { createSupabaseClient, resolveLocalStackConfig } from "@/repository";
import type { QuizStatus } from "@/domain";
import { retryQuiz } from "../actions";
import { RetryButton } from "../retry-button";

const STATUS_KEYS: Record<QuizStatus, "pending" | "generating" | "delivered" | "failed"> = {
  pending: "pending",
  generating: "generating",
  delivered: "delivered",
  failed: "failed",
};

export default async function OrderDetailPage({ params }: PageProps<"/admin/orders/[id]">) {
  const t = await getTranslations("orders.detail");
  const { id } = await params;

  const client = createSupabaseClient(resolveLocalStackConfig());
  const detail = await loadOrderDetail(client, id);

  if (!detail) {
    return (
      <div className="flex flex-col gap-4">
        <p>{t("notFound")}</p>
        <Link href="/admin/orders" className="underline">
          {t("back")}
        </Link>
      </div>
    );
  }

  const { order, quizzes } = detail;
  const shopUrl = process.env.WOOCOMMERCE_URL;

  const retryErrorMessages = {
    retryRefused: t("retry.retryRefused"),
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("title", { orderNumber: order.wooOrderId })}</h1>
        <Link href="/admin/orders" className="underline">
          {t("back")}
        </Link>
      </div>

      <p>
        {t("email")}: {order.billingEmail}
      </p>

      {shopUrl && (
        <a href={wooAdminOrderUrl(shopUrl, order.wooOrderId)} target="_blank" rel="noreferrer" className="underline">
          {t("wooLink")}
        </a>
      )}

      <ul className="flex flex-col gap-6">
        {quizzes.map((quiz) => (
          <li key={quiz.id} className="flex flex-col gap-2 border p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{t("quiz", { number: quiz.number })}</h2>
              <span>{t(`status.${STATUS_KEYS[quiz.status]}`)}</span>
            </div>

            {quiz.failureReason && <p>{t("failureReason", { reason: quiz.failureReason })}</p>}
            {quiz.deliveredAt && <p>{t("deliveredAt", { date: quiz.deliveredAt })}</p>}
            <p>{quiz.hasDownloadToken ? t("downloadTokenPresent") : t("downloadTokenAbsent")}</p>

            {quiz.status === "failed" && (
              <RetryButton
                quizId={quiz.id}
                label={t("retry.button")}
                confirmMessage={t("retry.confirm")}
                successMessage={t("retry.success")}
                errorMessages={retryErrorMessages}
                action={retryQuiz}
              />
            )}

            <div className="flex flex-col gap-1">
              <h3 className="font-medium">{t("composition.heading")}</h3>
              {!quiz.slots && <p>{t("composition.notAvailable")}</p>}
              {quiz.slots && (
                <ul className="flex flex-col gap-1">
                  {quiz.slots.map((slot) => (
                    <li key={slot.slotIndex}>
                      <span className="font-medium">{t(`composition.slotKind.${slot.kind}`)}</span>
                      {" - "}
                      {slot.categoryName}: {slot.items.map((item) => item.answerText).join(", ")}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
