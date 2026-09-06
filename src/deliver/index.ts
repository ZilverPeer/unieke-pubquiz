/**
 * deliver: Deliverables -> WooCommerce. Knows Quiz and order identifiers and
 * file URLs; never Items or Compositions (CONTEXT.md "Pipeline orthogonality").
 *
 * Interface pinned on master for spec #36. Implemented in #41; the worker (#40)
 * codes against this shape and tests with a stub. See README.md for the full
 * design (why line item meta_data + a shop plugin, not WooCommerce's native
 * downloadable-product files; what the module may/may not know).
 */
import type { DeliverableFile } from "@/domain";
import { downloadMetaKey, OPERATOR_NOTE_PREFIX } from "@/domain";
import type { DelivererConfig } from "./config";
import type { OrderLookup } from "./order-lookup";
import { createWooCommerceClient } from "./woocommerce-client";

export type { DelivererConfig } from "./config";
export { resolveDelivererConfigFromEnv } from "./config";
export { createOrderLookup, type OrderLookup, type QuizOrderContext } from "./order-lookup";

export interface DeliveredFile {
  file: DeliverableFile;
  /** Absolute URL of the app download route for this file. */
  url: string;
}

export interface Deliverer {
  /** Attach the Quiz's files to its line item; complete the order once every Quiz of it is delivered. */
  deliverQuiz(input: { quizId: string; files: readonly DeliveredFile[] }): Promise<void>;
  /** Add a private operator note for a failed Quiz; leave the order status alone. */
  noteFailure(input: { quizId: string; reason: string }): Promise<void>;
}

interface WooMetaDatum {
  id?: number;
  key: string;
  value: string;
}

interface WooLineItem {
  id: number;
  meta_data?: WooMetaDatum[];
}

interface WooOrder {
  id: number;
  status: string;
  line_items: WooLineItem[];
}

/**
 * Creates a Deliverer, a thin wrapper over the WooCommerce REST API.
 *
 * `config` is the shop's REST credentials (see config.ts /
 * resolveDelivererConfigFromEnv for the worker's default). `orderLookup`
 * resolves a Quiz id to its WooCommerce order id, line item id, and sibling
 * Quiz statuses -- an adapter over the repository lives in order-lookup.ts
 * so this module itself never imports Items or Compositions.
 */
export function createDeliverer(config: DelivererConfig, orderLookup: OrderLookup): Deliverer {
  const client = createWooCommerceClient(config);

  return {
    async deliverQuiz({ quizId, files }) {
      const { wooOrderId, wooLineItemId, siblingStatuses } = await orderLookup.forQuiz(quizId);

      // GET first so a retried/duplicate call updates the same meta_data
      // entries in place (by their WooCommerce meta id) instead of
      // duplicating them -- WooCommerce's order PUT has no upsert-by-key
      // semantics for meta_data (see README.md "How downloads are attached").
      const order = await client.get<WooOrder>(`/wc/v3/orders/${wooOrderId}`);
      const lineItem = order.line_items.find((item) => item.id === wooLineItemId);
      if (!lineItem) {
        throw new Error(`deliver: line item ${wooLineItemId} not found on order ${wooOrderId}`);
      }
      const existingMeta = lineItem.meta_data ?? [];

      const metaData: WooMetaDatum[] = files.map(({ file, url }) => {
        const key = downloadMetaKey(file);
        const existing = existingMeta.find((meta) => meta.key === key);
        return existing ? { id: existing.id, key, value: url } : { key, value: url };
      });

      await client.put(`/wc/v3/orders/${wooOrderId}`, {
        line_items: [{ id: wooLineItemId, meta_data: metaData }],
      });

      const everyQuizDelivered = siblingStatuses.length > 0 && siblingStatuses.every((status) => status === "delivered");
      if (everyQuizDelivered && order.status !== "completed") {
        await client.put(`/wc/v3/orders/${wooOrderId}`, { status: "completed" });
      }
    },

    async noteFailure({ quizId, reason }) {
      const { wooOrderId, wooLineItemId } = await orderLookup.forQuiz(quizId);

      await client.post(`/wc/v3/orders/${wooOrderId}/notes`, {
        note: `${OPERATOR_NOTE_PREFIX} line item ${wooLineItemId}: ${reason}`,
        customer_note: false,
      });
    },
  };
}
