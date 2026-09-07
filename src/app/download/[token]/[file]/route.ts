/**
 * Download route (ticket #42): GET only, path shape pinned by
 * downloadPath(token, file) in src/domain/orders.ts -- do not re-derive it
 * here. Kept thin: all the 404/410/200 decision logic lives in
 * resolveDownload (src/app/download/resolve-download.ts), driven directly
 * by its own unit tests; this file only adapts Request/Response.
 */
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
    getQuizByDownloadToken: (t) => orderRepository.getQuizByDownloadToken(t),
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
