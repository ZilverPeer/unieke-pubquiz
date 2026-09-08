/**
 * Ticket #67: the "Product" and "Add to cart" lines `loop:up` prints from
 * `shop:up`'s `SetupResult` (see scripts/shop/lib/setup-result-file.ts for
 * how that result reaches this process). Pure so it can be unit tested
 * without a running shop -- kept in scripts/loop/lib rather than
 * scripts/shop/lib because it's specifically `loop:up`'s summary block.
 */
import type { SetupResult } from "../../shop/lib/setup-result";
import { WP_ENV_PORT } from "../../shop/lib/config";

export function formatShopSetupLines(result: SetupResult): string[] {
  return [
    `Product: #${result.productId}`,
    `Add to cart: http://localhost:${WP_ENV_PORT}/?add-to-cart=${result.productId}`,
  ];
}
