/**
 * Admin support view read model (spec 4, ticket #93): looking up an Order by
 * WooCommerce order number or billing email, and the read-only detail (its
 * Quizzes, their Composition resolved to Category names and Items' answer
 * text). A plain module of functions taking the typed Supabase client, like
 * src/repository/orders.ts -- not folded into that file (admin-common brief
 * "Layout rules": each spec 4 admin ticket writes to its own
 * src/repository/admin/<area>.ts, not the pipeline repositories). May import
 * only src/domain, src/admin/orders (the pure classifier) and supabase-js.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ItemKind, Locale, OrderRecord, QuizStatus } from "@/domain";
import { orderWideQuizSequence, SLOT_KINDS } from "@/domain";
import { classifyQuery } from "@/admin/orders/classify";
import { createSupabaseClient, type RepositoryConfig } from "@/repository/client";
import type { Database } from "@/repository/database.types";

type OrderRow = Database["public"]["Tables"]["orders"]["Row"];

// See src/repository/orders.ts's normalizeBillingEmail / CONTEXT.md
// "No-repeat rule" -- same rule, duplicated rather than shared because this
// admin module has no shared private module with the pipeline repository
// (mirrors compositions.ts's own documented duplication of the same rule).
function normalizeBillingEmail(billingEmail: string): string {
  return billingEmail.trim().toLowerCase();
}

function toOrderRecord(row: OrderRow): OrderRecord {
  return {
    id: row.id,
    wooOrderId: row.woo_order_id,
    billingEmail: row.billing_email,
    wooStatus: row.status,
    createdAt: row.created_at,
  };
}

export async function getOrderByWooOrderId(
  client: SupabaseClient<Database>,
  wooOrderId: number,
): Promise<OrderRecord | null> {
  const { data, error } = await client.from("orders").select().eq("woo_order_id", wooOrderId).maybeSingle();
  if (error) throw error;
  return data ? toOrderRecord(data) : null;
}

async function listOrdersByBillingEmail(
  client: SupabaseClient<Database>,
  billingEmail: string,
): Promise<OrderRecord[]> {
  const { data, error } = await client
    .from("orders")
    .select()
    .eq("billing_email", normalizeBillingEmail(billingEmail))
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(toOrderRecord);
}

export interface FindOrdersInput {
  query: string;
}

/**
 * Looks up an Order by WooCommerce order number (digits) or billing email
 * (contains "@"), per classifyQuery. An order number matches at most one
 * Order; a billing email may match several (a customer can place more than
 * one order). An "invalid" query (empty, or neither shape) matches none --
 * the search page's own field validation is what tells the operator why.
 */
export async function findOrders(client: SupabaseClient<Database>, input: FindOrdersInput): Promise<OrderRecord[]> {
  const { kind } = classifyQuery(input.query);

  if (kind === "order-number") {
    const order = await getOrderByWooOrderId(client, Number(input.query.trim()));
    return order ? [order] : [];
  }
  if (kind === "email") {
    return listOrdersByBillingEmail(client, input.query);
  }
  return [];
}

/** One Item in a resolved Round slot, display-ready for the support view. */
export interface OrderDetailItem {
  itemId: string;
  /** The Item's answer text in the Quiz's Locale (Text/Picture Items), or "<artist> - <title>" (Music Items -- artist/title are language-neutral, never translated, see CONTEXT.md "Translation"). */
  answerText: string;
}

/** One Round slot of a Quiz's Composition, resolved for display. */
export interface OrderDetailSlot {
  slotIndex: number;
  kind: ItemKind;
  categoryName: string;
  items: OrderDetailItem[];
}

export interface OrderDetailQuiz {
  id: string;
  /** 1-based position among every Quiz belonging to the Order (orderWideQuizSequence + 1). */
  number: number;
  status: QuizStatus;
  failureReason: string | null;
  deliveredAt: string | null;
  hasDownloadToken: boolean;
  /** null when the Quiz has no Composition yet (never generated, or still pending/generating without one recorded). */
  slots: OrderDetailSlot[] | null;
}

export interface OrderDetail {
  order: OrderRecord;
  quizzes: OrderDetailQuiz[];
}

interface QuizRow {
  id: string;
  woo_line_item_id: number;
  sequence: number;
  status: QuizStatus;
  failure_reason: string | null;
  delivered_at: string | null;
  download_token: string | null;
  composition_id: string | null;
  locale: Locale;
}

interface CompositionItemRow {
  composition_id: string;
  slot_index: number;
  position: number;
  item_id: string;
}

interface ItemRow {
  id: string;
  kind: ItemKind;
  subsubcategory_id: number;
}

interface SubsubcategoryRow {
  id: number;
  subcategories: { id: number; category_id: number } | null;
}

async function resolveSlotsByComposition(
  client: SupabaseClient<Database>,
  compositionIds: string[],
  locale: Locale,
): Promise<Map<string, OrderDetailSlot[]>> {
  const result = new Map<string, OrderDetailSlot[]>();
  if (compositionIds.length === 0) return result;

  const { data: compositionItemRows, error: compositionItemsError } = await client
    .from("composition_items")
    .select("composition_id, slot_index, position, item_id")
    .in("composition_id", compositionIds)
    .order("slot_index", { ascending: true })
    .order("position", { ascending: true });
  if (compositionItemsError) throw compositionItemsError;

  const itemIds = [...new Set((compositionItemRows as CompositionItemRow[]).map((row) => row.item_id))];
  if (itemIds.length === 0) {
    for (const compositionId of compositionIds) result.set(compositionId, []);
    return result;
  }

  const [itemsResult, subsubcategoriesResult, categoryTranslationsResult, itemTranslationsResult, musicDetailsResult] =
    await Promise.all([
      client.from("items").select("id, kind, subsubcategory_id").in("id", itemIds),
      client.from("subsubcategories").select("id, subcategories(id, category_id)"),
      client.from("category_translations").select("category_id, name").eq("locale", locale),
      client.from("item_translations").select("item_id, answer").eq("locale", locale).in("item_id", itemIds),
      client.from("music_item_details").select("item_id, artist, title").in("item_id", itemIds),
    ]);
  if (itemsResult.error) throw itemsResult.error;
  if (subsubcategoriesResult.error) throw subsubcategoriesResult.error;
  if (categoryTranslationsResult.error) throw categoryTranslationsResult.error;
  if (itemTranslationsResult.error) throw itemTranslationsResult.error;
  if (musicDetailsResult.error) throw musicDetailsResult.error;

  const categoryIdBySubsubcategoryId = new Map<number, number>();
  for (const row of subsubcategoriesResult.data as SubsubcategoryRow[]) {
    if (row.subcategories) categoryIdBySubsubcategoryId.set(row.id, row.subcategories.category_id);
  }

  const categoryNameById = new Map<number, string>();
  for (const row of categoryTranslationsResult.data) categoryNameById.set(row.category_id, row.name);

  const itemsById = new Map<string, ItemRow>();
  for (const row of itemsResult.data as ItemRow[]) itemsById.set(row.id, row);

  const answerByItemId = new Map<string, string>();
  for (const row of itemTranslationsResult.data) answerByItemId.set(row.item_id, row.answer ?? "");

  const musicByItemId = new Map<string, { artist: string; title: string }>();
  for (const row of musicDetailsResult.data) musicByItemId.set(row.item_id, { artist: row.artist, title: row.title });

  function answerTextFor(itemId: string): string {
    const music = musicByItemId.get(itemId);
    if (music) return `${music.artist} - ${music.title}`;
    return answerByItemId.get(itemId) ?? "";
  }

  function categoryNameFor(itemId: string): string {
    const item = itemsById.get(itemId);
    if (!item) return "";
    const categoryId = categoryIdBySubsubcategoryId.get(item.subsubcategory_id);
    if (categoryId === undefined) return "";
    return categoryNameById.get(categoryId) ?? "";
  }

  const rowsByComposition = new Map<string, CompositionItemRow[]>();
  for (const row of compositionItemRows as CompositionItemRow[]) {
    const rows = rowsByComposition.get(row.composition_id) ?? [];
    rows.push(row);
    rowsByComposition.set(row.composition_id, rows);
  }

  for (const compositionId of compositionIds) {
    const rows = rowsByComposition.get(compositionId) ?? [];
    const bySlot = new Map<number, CompositionItemRow[]>();
    for (const row of rows) {
      const slotRows = bySlot.get(row.slot_index) ?? [];
      slotRows.push(row);
      bySlot.set(row.slot_index, slotRows);
    }

    const slots: OrderDetailSlot[] = [...bySlot.keys()]
      .sort((a, b) => a - b)
      .map((slotIndex) => {
        const slotRows = bySlot.get(slotIndex)!;
        return {
          slotIndex,
          kind: SLOT_KINDS[slotIndex],
          categoryName: categoryNameFor(slotRows[0].item_id),
          items: slotRows.map((row) => ({ itemId: row.item_id, answerText: answerTextFor(row.item_id) })),
        };
      });

    result.set(compositionId, slots);
  }

  return result;
}

/** null when no Order with this id exists. */
export async function loadOrderDetail(client: SupabaseClient<Database>, orderId: string): Promise<OrderDetail | null> {
  const { data: orderRow, error: orderError } = await client.from("orders").select().eq("id", orderId).maybeSingle();
  if (orderError) throw orderError;
  if (!orderRow) return null;

  const { data: quizRows, error: quizzesError } = await client
    .from("quizzes")
    .select("id, woo_line_item_id, sequence, status, failure_reason, delivered_at, download_token, composition_id, locale")
    .eq("order_id", orderId)
    .order("woo_line_item_id", { ascending: true })
    .order("sequence", { ascending: true });
  if (quizzesError) throw quizzesError;

  const quizzes = quizRows as QuizRow[];
  const orderedQuizIds = quizzes.map((quiz) => quiz.id);

  // Locale is per-Quiz (QuizConfig.locale, CONTEXT.md "Locale is data, not
  // code"), not per-Order -- resolveSlotsByComposition is called once per
  // Locale actually in use so a mixed-Locale Order (rare, but not
  // impossible: distinct line items can request different Locales) never
  // resolves one Quiz's Items in another Quiz's Locale.
  const localesInUse = [...new Set(quizzes.map((quiz) => quiz.locale))];
  const slotsByComposition = new Map<string, OrderDetailSlot[]>();
  for (const locale of localesInUse) {
    const compositionIdsForLocale = [
      ...new Set(
        quizzes
          .filter((quiz) => quiz.locale === locale && quiz.composition_id !== null)
          .map((quiz) => quiz.composition_id as string),
      ),
    ];
    const resolved = await resolveSlotsByComposition(client, compositionIdsForLocale, locale);
    for (const [compositionId, slots] of resolved) slotsByComposition.set(compositionId, slots);
  }

  return {
    order: toOrderRecord(orderRow),
    quizzes: quizzes.map((quiz) => ({
      id: quiz.id,
      number: orderWideQuizSequence(quiz.id, orderedQuizIds) + 1,
      status: quiz.status,
      failureReason: quiz.failure_reason,
      deliveredAt: quiz.delivered_at,
      hasDownloadToken: quiz.download_token !== null,
      slots: quiz.composition_id ? (slotsByComposition.get(quiz.composition_id) ?? []) : null,
    })),
  };
}

export function createOrdersAdminRepository(config: RepositoryConfig) {
  const client = createSupabaseClient(config);
  return {
    findOrders: (input: FindOrdersInput) => findOrders(client, input),
    loadOrderDetail: (orderId: string) => loadOrderDetail(client, orderId),
  };
}
