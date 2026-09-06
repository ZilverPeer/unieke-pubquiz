import { wpCli, wpCliJson } from "./wp-cli";
import { WEBHOOK_NAME, WEBHOOK_TOPIC, DEFAULT_WEBHOOK_URL } from "./config";

interface WcWebhook {
  id: number;
  name: string;
  status: string;
  topic: string;
  delivery_url: string;
}

/**
 * Creates (or, if one by our name already exists, updates in place) the
 * `order.updated` webhook used by `npm run shop:capture`. The delivery URL
 * and secret can be overridden via WOOCOMMERCE_WEBHOOK_URL /
 * WOOCOMMERCE_WEBHOOK_SECRET (see .env.example); both default to local
 * values that work out of the box against `npm run shop:capture`.
 */
export function ensureWebhook(): { id: number; deliveryUrl: string } {
  const deliveryUrl = process.env.WOOCOMMERCE_WEBHOOK_URL ?? DEFAULT_WEBHOOK_URL;
  const secret = process.env.WOOCOMMERCE_WEBHOOK_SECRET ?? "test-secret";

  const existing = wpCliJson<WcWebhook[]>(["wc", "webhook", "list", "--format=json"]);
  const found = existing.find((hook) => hook.name === WEBHOOK_NAME);

  if (found) {
    if (found.delivery_url !== deliveryUrl) {
      // wp wc webhook update has no --delivery_url option (WooCommerce's
      // native WP-CLI command; the delivery URL is create-only there) --
      // recreate instead when it needs to change.
      wpCli(["wc", "webhook", "delete", String(found.id)]);
    } else {
      wpCli([
        "wc",
        "webhook",
        "update",
        String(found.id),
        `--topic=${WEBHOOK_TOPIC}`,
        `--secret=${secret}`,
        "--status=active",
      ]);
      return { id: found.id, deliveryUrl };
    }
  }

  const id = wpCliJson<number>([
    "wc",
    "webhook",
    "create",
    `--name=${WEBHOOK_NAME}`,
    `--topic=${WEBHOOK_TOPIC}`,
    `--delivery_url=${deliveryUrl}`,
    `--secret=${secret}`,
    "--status=active",
    "--porcelain",
  ]);
  return { id, deliveryUrl };
}
