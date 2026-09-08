/**
 * Classifies the Orders search box's single input (spec 4, ticket #93): a
 * WooCommerce order number is digits only, a billing email search contains
 * "@"; anything else (including empty/whitespace-only input) is invalid.
 * Pure, so `findOrders` (src/repository/admin/orders.ts) and the search
 * page's own field-level error both share this one rule.
 */
export type QueryKind = "order-number" | "email" | "invalid";

export interface ClassifiedQuery {
  kind: QueryKind;
}

export function classifyQuery(input: string): ClassifiedQuery {
  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return { kind: "invalid" };
  }
  if (/^\d+$/.test(trimmed)) {
    return { kind: "order-number" };
  }
  if (trimmed.includes("@")) {
    return { kind: "email" };
  }
  return { kind: "invalid" };
}
