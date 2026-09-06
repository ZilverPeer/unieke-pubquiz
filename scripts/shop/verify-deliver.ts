/**
 * One-shot empirical check for the deliver module (ticket #41) against a
 * running local shop. Not part of the test suite / not wired to package.json
 * -- run manually with tsx after `npm run shop:up` and `npm run shop:order`.
 * Bypasses the repository/Supabase entirely: a fake OrderLookup supplies the
 * WooCommerce order/line item ids directly, since this module never needs
 * anything else from the repository.
 *
 * Usage:
 *   npx tsx scripts/shop/verify-deliver.ts deliver <orderId> <lineItemId>
 *   npx tsx scripts/shop/verify-deliver.ts fail <orderId> <lineItemId> "<reason>"
 */
import { createDeliverer, type OrderLookup } from "../../src/deliver";
import { downloadPath } from "../../src/domain";

const [, , mode, orderIdRaw, lineItemIdRaw, reason] = process.argv;

if (!mode || !orderIdRaw || !lineItemIdRaw) {
  console.error("Usage: verify-deliver.ts <deliver|fail> <orderId> <lineItemId> [reason]");
  process.exit(1);
}

const wooOrderId = Number(orderIdRaw);
const wooLineItemId = Number(lineItemIdRaw);

const fakeOrderLookup: OrderLookup = {
  async forQuiz() {
    return {
      wooOrderId,
      wooLineItemId,
      // Single-Quiz order: "delivered" here is enough to trigger completion.
      siblingStatuses: ["delivered"],
    };
  },
};

const config = {
  baseUrl: process.env.WOOCOMMERCE_URL ?? "http://localhost:45330",
  consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY ?? "",
  consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET ?? "",
};

if (!config.consumerKey || !config.consumerSecret) {
  console.error("Set WOOCOMMERCE_CONSUMER_KEY / WOOCOMMERCE_CONSUMER_SECRET (see .env.shop.local).");
  process.exit(1);
}

const deliverer = createDeliverer(config, fakeOrderLookup);

async function main() {
  if (mode === "deliver") {
    const files = ["quizmaster.pdf", "picture-handout.pdf", "answer-sheet.pdf", "music-round.mp3"] as const;
    await deliverer.deliverQuiz({
      quizId: "verify-deliver-script",
      files: files.map((file) => ({ file, url: `http://localhost:3000${downloadPath("test-token", file)}` })),
    });
    console.log(`deliverQuiz done for order ${wooOrderId} / line item ${wooLineItemId}`);
  } else if (mode === "fail") {
    await deliverer.noteFailure({ quizId: "verify-deliver-script", reason: reason ?? "empirical check failure" });
    console.log(`noteFailure done for order ${wooOrderId} / line item ${wooLineItemId}`);
  } else {
    console.error(`Unknown mode "${mode}"`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
