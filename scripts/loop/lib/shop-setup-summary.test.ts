import { describe, expect, test } from "vitest";
import { formatShopSetupLines } from "./shop-setup-summary";
import type { SetupResult } from "../../shop/lib/setup-result";

/**
 * Ticket #67: `loop:up`'s final block gains the product id and the
 * add-to-cart URL `shop:up` set up, read from the persisted `SetupResult`
 * (see scripts/shop/lib/setup-result-file.ts). Pure seam, unit tested
 * separately from the file read.
 */
describe("formatShopSetupLines", () => {
  test("builds the Product and Add to cart lines from a SetupResult", () => {
    const result: SetupResult = {
      productId: 10,
      webhookId: 3,
      deliveryUrl: "http://host.docker.internal:3000/api/webhooks/woocommerce",
      consumerKey: "ck_abc",
      consumerSecret: "cs_def",
    };

    expect(formatShopSetupLines(result)).toEqual([
      "Product: #10",
      "Add to cart: http://localhost:45330/?add-to-cart=10",
    ]);
  });

  test("never includes the consumerKey or consumerSecret", () => {
    const result: SetupResult = {
      productId: 10,
      webhookId: 3,
      deliveryUrl: "http://host.docker.internal:3000/api/webhooks/woocommerce",
      consumerKey: "SECRET_KEY_MARKER",
      consumerSecret: "SECRET_MARKER",
    };

    const lines = formatShopSetupLines(result).join("\n");
    expect(lines).not.toContain("SECRET_KEY_MARKER");
    expect(lines).not.toContain("SECRET_MARKER");
  });
});
