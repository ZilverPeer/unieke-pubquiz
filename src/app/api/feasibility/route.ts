/**
 * Checkout feasibility endpoint (spec 5, ticket #102): answers, per cart
 * line, whether a Quiz can be generated for a billing email against the
 * live pool and that email's delivered Compositions (the no-repeat rule),
 * without persisting anything. See README.md for the request/response
 * shape and the signature scheme.
 *
 * Kept thin, the same way src/app/api/webhooks/woocommerce/route.ts is:
 * parsing lives in parse-request.ts, the dry-run orchestration in
 * check-feasibility.ts, both driven directly by their own tests; this file
 * only adapts Request/Response and wires the real repository. Imports only
 * from domain, repository, sample and the webhook folder's
 * verify-signature -- never deliver, render or worker.
 */
import { createCategoryIdLookup, createRepository, resolveLocalStackConfig } from "@/repository";
import { verifySignature } from "../webhooks/woocommerce/verify-signature";
import { checkFeasibility } from "./check-feasibility";
import { parseFeasibilityRequest } from "./parse-request";

const config = resolveLocalStackConfig();
const repository = createRepository(config);
const loadCategoryIds = createCategoryIdLookup(config);

function errorResponse(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const signatureHeader = request.headers.get("x-pubquiz-signature");
  const secret = process.env.WOOCOMMERCE_WEBHOOK_SECRET ?? "test-secret";

  if (!verifySignature(rawBody, signatureHeader, secret)) {
    return errorResponse(401, "invalid signature");
  }

  const parsed = parseFeasibilityRequest(rawBody);
  if (typeof parsed === "string") {
    return errorResponse(400, parsed);
  }

  const categoryIds = await loadCategoryIds();
  const result = await checkFeasibility(parsed, {
    loadPool: repository.loadPool,
    loadExcludedItemIds: repository.loadExcludedItemIds,
    categoryIds,
  });

  return Response.json(result, { status: 200 });
}
