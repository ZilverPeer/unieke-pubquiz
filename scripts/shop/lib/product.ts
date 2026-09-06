import { wpCliJson } from "./wp-cli";
import { PUBQUIZ_PRODUCT_NAME, PUBQUIZ_PRODUCT_SLUG } from "./config";

interface WcProduct {
  id: number;
  slug: string;
}

/** Finds the Pubquiz product by slug, creating it (idempotently) if missing. */
export function getOrCreateProductId(): number {
  const existing = wpCliJson<WcProduct[]>([
    "wc",
    "product",
    "list",
    `--slug=${PUBQUIZ_PRODUCT_SLUG}`,
    "--format=json",
  ]);
  if (existing.length > 0) {
    return existing[0].id;
  }

  return wpCliJson<number>([
    "wc",
    "product",
    "create",
    `--name=${PUBQUIZ_PRODUCT_NAME}`,
    `--slug=${PUBQUIZ_PRODUCT_SLUG}`,
    "--type=simple",
    "--status=publish",
    "--virtual=true",
    "--downloadable=true",
    "--download_expiry=30",
    "--regular_price=9.95",
    "--porcelain",
  ]);
}
