import { wpCliJson } from "./wp-cli";
import { PUBQUIZ_PRODUCT_SLUG } from "./config";

interface WcProduct {
  id: number;
  slug: string;
}

/**
 * Looks up the Pubquiz product's id by slug. `npm run shop:up`
 * (setup-shop.php, ticket #61) owns creating the product and converging its
 * Dutch name/short description/price on every run -- this is only used by
 * `shop:order` (place-order.ts) to find the id of a product that shop:up has
 * already created.
 */
export function getProductId(): number {
  const existing = wpCliJson<WcProduct[]>([
    "wc",
    "product",
    "list",
    `--slug=${PUBQUIZ_PRODUCT_SLUG}`,
    "--format=json",
  ]);
  if (existing.length === 0) {
    throw new Error(`Pubquiz product (slug=${PUBQUIZ_PRODUCT_SLUG}) not found -- run "npm run shop:up" first.`);
  }
  return existing[0].id;
}
