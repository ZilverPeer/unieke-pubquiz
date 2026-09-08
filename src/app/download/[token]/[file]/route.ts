/**
 * Download route (ticket #42): GET only, path shape pinned by
 * downloadPath(token, file) in src/domain/orders.ts -- do not re-derive it
 * here. Kept thin: all the 404/410/200 decision logic lives in
 * resolveDownload (src/app/download/resolve-download.ts), driven directly
 * by its own unit tests; this file only adapts Request/Response.
 */
import { orderWideQuizSequence } from "@/domain";
import { createDeliverableDownloader, createOrderRepository, resolveLocalStackConfig } from "@/repository";
import { resolveDownload } from "../../resolve-download";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; file: string }> },
): Promise<Response> {
  const { token, file } = await params;

  const config = resolveLocalStackConfig();
  const orderRepository = createOrderRepository(config);
  const downloadDeliverable = createDeliverableDownloader(config);

  const result = await resolveDownload(token, file, {
    // Joins the Quiz to its order here (not in resolveDownload, which stays
    // repository-agnostic): the file name needs the order's wooOrderId,
    // which QuizRecord itself doesn't carry (src/domain/orders.ts).
    getQuizByDownloadToken: async (t) => {
      const quiz = await orderRepository.getQuizByDownloadToken(t);
      if (!quiz) return null;
      const order = await orderRepository.getOrderById(quiz.orderId);
      if (!order) return null;
      // The zip file name's "<sequence + 1>" must be unique across the whole
      // order, not just among Quizzes sharing this Quiz's line item (see
      // DownloadQuizLookup's doc comment in resolve-download.ts) -- so this
      // finds the Quiz's 0-based position among every Quiz belonging to the
      // order, via the one shared function (orderWideQuizSequence,
      // src/domain/orders.ts) the deliverer also uses when it bakes this
      // same number into the pubquiz_download_<n> meta key at delivery time
      // (src/deliver/order-lookup.ts) -- both read listQuizzesByOrderId's
      // stable (woo_line_item_id, sequence) order, so the two can't compute
      // a different number for the same Quiz (ticket #73 PR review round 2).
      const siblings = await orderRepository.listQuizzesByOrderId(quiz.orderId);
      const sequenceInOrder = orderWideQuizSequence(
        quiz.id,
        siblings.map((sibling) => sibling.id),
      );
      return {
        id: quiz.id,
        prunedAt: quiz.prunedAt,
        wooOrderId: order.wooOrderId,
        sequenceInOrder,
        locale: quiz.config.locale,
      };
    },
    downloadDeliverable,
  });

  if (result.status === 404) {
    return new Response(null, { status: 404 });
  }
  if (result.status === 410) {
    return new Response(null, { status: 410 });
  }

  return new Response(new Uint8Array(result.body), {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
