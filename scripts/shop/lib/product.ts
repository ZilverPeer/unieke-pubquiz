import { wpCli, wpCliJson } from "./wp-cli";
import {
  PUBQUIZ_PRODUCT_NAME,
  PUBQUIZ_PRODUCT_PRICE,
  PUBQUIZ_PRODUCT_SHORT_DESCRIPTION,
  PUBQUIZ_PRODUCT_SLUG,
} from "./config";

interface WcProduct {
  id: number;
  slug: string;
}

/** WP-CLI options common to both `wc product create` and `wc product update`, so a re-run converges an existing product onto the current Dutch name/description/price rather than only setting them at creation. */
const PRODUCT_FIELD_ARGS = [
  `--name=${PUBQUIZ_PRODUCT_NAME}`,
  `--short_description=${PUBQUIZ_PRODUCT_SHORT_DESCRIPTION}`,
  `--regular_price=${PUBQUIZ_PRODUCT_PRICE}`,
];

/** Finds the Pubquiz product by slug, creating it if missing; either way (re)applies the Dutch name, short description and placeholder price so a re-run converges an already-existing product too. */
export function getOrCreateProductId(): number {
  const existing = wpCliJson<WcProduct[]>([
    "wc",
    "product",
    "list",
    `--slug=${PUBQUIZ_PRODUCT_SLUG}`,
    "--format=json",
  ]);
  if (existing.length > 0) {
    const id = existing[0].id;
    wpCli(["wc", "product", "update", String(id), ...PRODUCT_FIELD_ARGS]);
    return id;
  }

  return wpCliJson<number>([
    "wc",
    "product",
    "create",
    `--slug=${PUBQUIZ_PRODUCT_SLUG}`,
    "--type=simple",
    "--status=publish",
    "--virtual=true",
    "--downloadable=true",
    "--download_expiry=30",
    "--porcelain",
    ...PRODUCT_FIELD_ARGS,
  ]);
}
