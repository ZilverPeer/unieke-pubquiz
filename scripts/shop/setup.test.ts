import { describe, expect, test } from "vitest";
import { parseSetupResult } from "./lib/setup-result";

/**
 * `parseSetupResult` is the seam between setup-shop.php's single line of JSON
 * on stdout and the Node side (setup.ts) that upserts it into .env.local.
 * Kept pure and separately tested because the actual PHP output can only be
 * exercised against a running wp-env instance.
 */
describe("parseSetupResult", () => {
  const valid = JSON.stringify({
    productId: 14,
    webhookId: 3,
    deliveryUrl: "http://host.docker.internal:3000/api/webhooks/woocommerce",
    consumerKey: "ck_abc",
    consumerSecret: "cs_def",
  });

  test("parses a single JSON line into a typed result", () => {
    expect(parseSetupResult(valid)).toEqual({
      productId: 14,
      webhookId: 3,
      deliveryUrl: "http://host.docker.internal:3000/api/webhooks/woocommerce",
      consumerKey: "ck_abc",
      consumerSecret: "cs_def",
    });
  });

  test("tolerates a single trailing newline", () => {
    expect(parseSetupResult(`${valid}\n`)).toEqual(JSON.parse(valid));
  });

  test("rejects output with more than one non-empty line", () => {
    expect(() => parseSetupResult(`some diagnostic line\n${valid}`)).toThrow(
      /exactly one/i,
    );
  });

  test("rejects output missing a required key", () => {
    const missingKey = JSON.stringify({
      productId: 14,
      webhookId: 3,
      deliveryUrl: "http://host.docker.internal:3000/api/webhooks/woocommerce",
      consumerKey: "ck_abc",
      // consumerSecret missing
    });
    expect(() => parseSetupResult(missingKey)).toThrow(/consumerSecret/);
  });

  test("rejects output that isn't JSON", () => {
    expect(() => parseSetupResult("not json")).toThrow();
  });

  test("rejects a non-integer productId", () => {
    const badProductId = JSON.stringify({
      productId: "14",
      webhookId: 3,
      deliveryUrl: "http://host.docker.internal:3000/api/webhooks/woocommerce",
      consumerKey: "ck_abc",
      consumerSecret: "cs_def",
    });
    expect(() => parseSetupResult(badProductId)).toThrow(/productId/);
  });

  test("rejects an empty consumerKey", () => {
    const emptyConsumerKey = JSON.stringify({
      productId: 14,
      webhookId: 3,
      deliveryUrl: "http://host.docker.internal:3000/api/webhooks/woocommerce",
      consumerKey: "",
      consumerSecret: "cs_def",
    });
    expect(() => parseSetupResult(emptyConsumerKey)).toThrow(/consumerKey/);
  });
});
