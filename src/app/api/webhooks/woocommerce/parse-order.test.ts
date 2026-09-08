import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseOrderPayload } from "./parse-order";

// Recorded real WooCommerce payload (ticket #37, re-recorded for #71 now
// that the checkout no longer sends a mode meta key, and again for #72's
// Categorieën checkboxes field) -- one line item, quantity 1, three
// Category picks in pick order (ids "1", "3", "5") plus locale/difficulty
// meta -- see shop/README.md "The webhook".
const FIXTURE_PATH = join(process.cwd(), "shop/fixtures/order-updated-processing.json");

function loadFixtureBody(): Record<string, unknown> {
  const captured = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as { body: unknown };
  return captured.body as Record<string, unknown>;
}

// Category ids that exist in supabase/seed.sql (1..8) -- see
// src/repository/orders.integration.test.ts's own CATEGORY_PICKS for the
// same convention.
const EXISTING_CATEGORY_IDS = new Set(["1", "2", "3", "4", "5", "6", "7", "8"]);

function cloneLineItems(body: Record<string, unknown>): Record<string, unknown>[] {
  return JSON.parse(JSON.stringify(body.line_items)) as Record<string, unknown>[];
}

function metaValue(lineItem: Record<string, unknown>, key: string): unknown {
  const metaData = lineItem.meta_data as { key: string; value: unknown }[];
  return metaData.find((entry) => entry.key === key)?.value;
}

function withMeta(
  lineItem: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const metaData = (lineItem.meta_data as { key: string; value: unknown }[]).filter((entry) => entry.key !== key);
  if (value !== undefined) metaData.push({ key, value });
  return { ...lineItem, meta_data: metaData };
}

describe("parseOrderPayload", () => {
  it("maps the fixture's order fields onto UpsertOrderInput", () => {
    const body = loadFixtureBody();

    const { input } = parseOrderPayload(body, EXISTING_CATEGORY_IDS);

    expect(input.wooOrderId).toBe(30);
    expect(input.billingEmail).toBe("fixture-buyer@example.com");
    expect(input.wooStatus).toBe("processing");
    expect(input.rawPayload).toBe(body);
  });

  it("parses the fixture's single line item into one OrderLineItem with no error", () => {
    const body = loadFixtureBody();

    const { input, lineItemErrors } = parseOrderPayload(body, EXISTING_CATEGORY_IDS);

    expect(input.lineItems).toHaveLength(1);
    const [lineItem] = input.lineItems;
    expect(lineItem.wooLineItemId).toBe(22);
    expect(lineItem.quantity).toBe(1);
    expect(lineItem.config).toEqual({
      locale: "nl",
      requestedDifficulty: "mixed",
      categoryPicks: ["1", "3", "5"],
    });
    expect(lineItemErrors.size).toBe(0);
  });

  it("ignores meta_data keys outside CHECKOUT_META_KEYS (e.g. an add-ons plugin's own bookkeeping key)", () => {
    const body = loadFixtureBody();
    const lineItems = cloneLineItems(body);
    (lineItems[0].meta_data as { key: string; value: unknown }[]).push({
      key: "_wapf_meta",
      value: '{"unrelated":"plugin bookkeeping"}',
    });

    const { input } = parseOrderPayload({ ...body, line_items: lineItems }, EXISTING_CATEGORY_IDS);

    expect(input.lineItems[0].config.locale).toBe("nl");
  });

  it("ignores a pubquiz_mode meta key, in case anything still writes one (the mode field group is gone as of #72)", () => {
    const body = loadFixtureBody();
    const lineItems = cloneLineItems(body);
    lineItems[0] = withMeta(lineItems[0], "pubquiz_mode", "single_category");

    const { input, lineItemErrors } = parseOrderPayload({ ...body, line_items: lineItems }, EXISTING_CATEGORY_IDS);

    expect(input.lineItems[0].config).toEqual({
      locale: "nl",
      requestedDifficulty: "mixed",
      categoryPicks: ["1", "3", "5"],
    });
    expect(lineItemErrors.size).toBe(0);
  });

  it("records a parse error and drops an unknown Category id from the picks, keeping the rest in order", () => {
    const body = loadFixtureBody();
    const lineItems = cloneLineItems(body);
    lineItems[0] = withMeta(lineItems[0], "pubquiz_category_1", "999");

    const { input, lineItemErrors } = parseOrderPayload({ ...body, line_items: lineItems }, EXISTING_CATEGORY_IDS);

    const [lineItem] = input.lineItems;
    expect(lineItem.config.categoryPicks).toEqual(["3", "5"]);
    expect(lineItemErrors.get(lineItem.wooLineItemId)).toMatch(/unknown category id "999"/i);
  });

  it("records a parse error and drops a duplicate Category id from the picks, keeping the first occurrence", () => {
    const body = loadFixtureBody();
    const lineItems = cloneLineItems(body);
    lineItems[0] = withMeta(lineItems[0], "pubquiz_category_2", "1");

    const { input, lineItemErrors } = parseOrderPayload({ ...body, line_items: lineItems }, EXISTING_CATEGORY_IDS);

    const [lineItem] = input.lineItems;
    expect(lineItem.config.categoryPicks).toEqual(["1", "5"]);
    expect(lineItemErrors.get(lineItem.wooLineItemId)).toMatch(/duplicate category id "1"/i);
  });

  it("stops collecting picks at the first missing key, ignoring any later key even if present", () => {
    const body = loadFixtureBody();
    const lineItems = cloneLineItems(body);
    lineItems[0] = withMeta(lineItems[0], "pubquiz_category_2", undefined);

    const { input, lineItemErrors } = parseOrderPayload({ ...body, line_items: lineItems }, EXISTING_CATEGORY_IDS);

    const [lineItem] = input.lineItems;
    expect(lineItem.config.categoryPicks).toEqual(["1"]);
    expect(lineItemErrors.size).toBe(0);
  });

  it("records a parse error for a missing Locale meta key", () => {
    const body = loadFixtureBody();
    const lineItems = cloneLineItems(body);
    lineItems[0] = withMeta(lineItems[0], "pubquiz_locale", undefined);
    expect(metaValue(lineItems[0], "pubquiz_locale")).toBeUndefined();

    const { input, lineItemErrors } = parseOrderPayload({ ...body, line_items: lineItems }, EXISTING_CATEGORY_IDS);

    expect(lineItemErrors.get(input.lineItems[0].wooLineItemId)).toMatch(/pubquiz_locale/i);
  });

  it("expands a line item's quantity into that many OrderLineItem quantity, not several line items", () => {
    const body = loadFixtureBody();
    const lineItems = cloneLineItems(body);
    lineItems[0] = { ...lineItems[0], quantity: 3 };

    const { input } = parseOrderPayload({ ...body, line_items: lineItems }, EXISTING_CATEGORY_IDS);

    expect(input.lineItems).toHaveLength(1);
    expect(input.lineItems[0].quantity).toBe(3);
  });
});
