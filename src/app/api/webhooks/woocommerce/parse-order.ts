/**
 * Pure mapping from a WooCommerce order webhook payload to the repository's
 * `UpsertOrderInput` (spec #36, ticket #39). Reads line item configuration
 * through `CHECKOUT_META_KEYS` (src/domain/checkout.ts) -- any other
 * meta_data key (e.g. the Advanced Product Fields add-ons plugin's own
 * `_wapf_meta` bookkeeping entry) is simply never read, so it is ignored
 * without special-casing.
 *
 * No I/O: Category id existence is checked against a `categoryIds` set the
 * caller (route.ts) loads once per request via `createCategoryIdLookup`
 * (src/repository/index.ts) -- this module only maps and validates, it
 * never reaches the repository or pg-boss itself (see route.ts / README.md).
 *
 * A line item whose configuration can't be fully trusted (unknown Category
 * id, missing/invalid Locale, mode or difficulty) is still mapped to a
 * best-effort `QuizConfig` -- every column in `quizzes` this maps onto is
 * `not null` (migration 00008_orders_quizzes.sql), so there is no way to
 * insert a Quiz row without *some* value for locale/quizMode/
 * requestedDifficulty. The caller (route.ts) inserts it as usual (default
 * status `pending`) and then transitions it straight to `failed` with the
 * recorded reason -- see README.md "Interface gap: parse failures and
 * UpsertOrderInput" for why this is the chosen shape over changing the
 * repository.
 */
import type { CategoryPick, Locale, QuizConfig, QuizMode, RequestedDifficulty } from "@/domain";
import { CHECKOUT_META_KEYS, SLOT_COUNT } from "@/domain";
import type { OrderLineItem, UpsertOrderInput } from "@/repository";

interface WooMetaDataEntry {
  key: string;
  value: unknown;
}

interface WooLineItem {
  id: number;
  quantity: number;
  meta_data?: WooMetaDataEntry[];
}

interface WooOrderPayload {
  id: number;
  status: string;
  billing?: { email?: string };
  line_items?: WooLineItem[];
}

export interface ParseOrderResult {
  input: UpsertOrderInput;
  /** wooLineItemId -> human-readable reason, for every line item that failed to parse. */
  lineItemErrors: ReadonlyMap<number, string>;
}

const VALID_LOCALES: readonly Locale[] = ["nl", "en"];
const VALID_QUIZ_MODES: readonly QuizMode[] = ["mixed", "single_category"];
const VALID_REQUESTED_DIFFICULTIES: readonly RequestedDifficulty[] = ["easy", "medium", "hard", "mixed"];

function metaMap(lineItem: WooLineItem): Map<string, unknown> {
  return new Map((lineItem.meta_data ?? []).map((entry) => [entry.key, entry.value]));
}

function parseEnum<T extends string>(
  meta: Map<string, unknown>,
  key: string,
  validValues: readonly T[],
  fallback: T,
  errors: string[],
): T {
  const raw = meta.get(key);
  if (typeof raw === "string" && (validValues as readonly string[]).includes(raw)) {
    return raw as T;
  }
  errors.push(`missing or invalid ${key}: ${JSON.stringify(raw ?? null)}`);
  return fallback;
}

function parseCategoryPicks(meta: Map<string, unknown>, categoryIds: ReadonlySet<string>, errors: string[]): CategoryPick[] {
  const picks: CategoryPick[] = [];
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const raw = meta.get(CHECKOUT_META_KEYS.categoryPick(slot));
    if (raw === undefined) {
      picks.push(undefined);
      continue;
    }
    const id = String(raw);
    if (categoryIds.has(id)) {
      picks.push(id);
    } else {
      errors.push(`unknown Category id "${id}" at slot ${slot}`);
      picks.push(undefined);
    }
  }
  return picks;
}

function parseLineItem(
  raw: WooLineItem,
  categoryIds: ReadonlySet<string>,
): { lineItem: OrderLineItem; error: string | null } {
  const meta = metaMap(raw);
  const errors: string[] = [];

  const locale = parseEnum(meta, CHECKOUT_META_KEYS.locale, VALID_LOCALES, "nl", errors);
  const quizMode = parseEnum(meta, CHECKOUT_META_KEYS.quizMode, VALID_QUIZ_MODES, "mixed", errors);
  const requestedDifficulty = parseEnum(
    meta,
    CHECKOUT_META_KEYS.requestedDifficulty,
    VALID_REQUESTED_DIFFICULTIES,
    "mixed",
    errors,
  );
  const categoryPicks = parseCategoryPicks(meta, categoryIds, errors);

  const config: QuizConfig = { locale, quizMode, requestedDifficulty, categoryPicks };
  const quantity = Number.isInteger(raw.quantity) && raw.quantity > 0 ? raw.quantity : 1;

  return {
    lineItem: { wooLineItemId: raw.id, quantity, config },
    error: errors.length > 0 ? errors.join("; ") : null,
  };
}

export function parseOrderPayload(payload: unknown, categoryIds: ReadonlySet<string>): ParseOrderResult {
  const order = payload as WooOrderPayload;

  const lineItemErrors = new Map<number, string>();
  const lineItems: OrderLineItem[] = [];

  for (const raw of order.line_items ?? []) {
    const { lineItem, error } = parseLineItem(raw, categoryIds);
    lineItems.push(lineItem);
    if (error) lineItemErrors.set(lineItem.wooLineItemId, error);
  }

  return {
    input: {
      wooOrderId: order.id,
      billingEmail: order.billing?.email ?? "",
      wooStatus: order.status,
      rawPayload: payload,
      lineItems,
    },
    lineItemErrors,
  };
}
