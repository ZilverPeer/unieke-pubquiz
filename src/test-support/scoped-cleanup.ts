/**
 * Scopes integration-suite cleanup to exactly the rows a test run created,
 * instead of wiping `orders`, `quizzes`, `compositions` and the
 * `deliverables` bucket wholesale (ticket #51 -- see
 * docs/agents/orchestration.md's former warning about this, and
 * src/scripts/generate.integration.test.ts's `freshEmail`/`afterEach`
 * pair, the model this generalises for every other integration suite).
 *
 * Every row these suites persist is reachable from a billing email: orders
 * and compositions carry `billing_email` directly, and quizzes reference
 * an order. Tracking billing emails is therefore enough to delete
 * precisely what a suite created -- never a real order placed through the
 * shop, and never another suite's fixture on the same shared stack.
 * `trackQuizId` covers the rarer case of a Quiz/Composition pair built
 * without going through an Order (so a bucket path can still be found and
 * removed even if nothing about it carries a billing email).
 *
 * Deletes in FK-safe order: quizzes first (nothing references a Quiz),
 * then orders (quizzes.order_id would otherwise block deleting them),
 * then compositions (quizzes.composition_id would otherwise block;
 * compositions cascade-deletes composition_items, and seed Items are never
 * touched), then any deliverables bucket objects for the quiz ids
 * involved.
 *
 * `trackItemId` (ticket #88, additive): the admin Items suite creates its
 * own Items directly (not reachable from a billing email at all), so it
 * tracks the ids it creates and cleanup() deletes their item_translations
 * row(s) first, then the item row itself -- never a seeded Item, since
 * only ids this suite created are ever tracked.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/repository/database.types";

export interface ScopedCleanup {
  /**
   * Tracks a billing email this suite used (or is about to use) to create
   * Orders/Quizzes/Compositions. Returns the email unchanged, so a call
   * site can wrap either a literal or a freshly generated one inline.
   */
  trackEmail(email: string): string;
  /**
   * Tracks a Quiz id created without going through an Order, so its
   * deliverables bucket objects are still found and removed. Returns the
   * id unchanged, for the same inline-wrapping convenience as trackEmail.
   */
  trackQuizId(quizId: string): string;
  /**
   * Tracks an Item id this suite created directly (ticket #88), so
   * cleanup() deletes its translation row(s) and the Item row itself.
   * Returns the id unchanged, for the same inline-wrapping convenience as
   * trackEmail/trackQuizId.
   */
  trackItemId(itemId: string): string;
  /**
   * Deletes every row/object reachable from the tracked emails, quiz ids
   * and Item ids, in FK-safe order, then clears tracking. Safe to call
   * with nothing tracked (a no-op).
   */
  cleanup(): Promise<void>;
}

const DELIVERABLES_BUCKET = "deliverables";

export function createScopedCleanup(db: SupabaseClient<Database>): ScopedCleanup {
  const emails = new Set<string>();
  const quizIds = new Set<string>();
  const itemIds = new Set<string>();

  function trackEmail(email: string): string {
    emails.add(email);
    return email;
  }

  function trackQuizId(quizId: string): string {
    quizIds.add(quizId);
    return quizId;
  }

  function trackItemId(itemId: string): string {
    itemIds.add(itemId);
    return itemId;
  }

  async function resolveQuizIds(emailList: string[]): Promise<Set<string>> {
    const resolved = new Set(quizIds);
    if (emailList.length === 0) return resolved;

    const { data: orders, error: ordersError } = await db.from("orders").select("id").in("billing_email", emailList);
    if (ordersError) throw ordersError;
    const orderIds = orders.map((order) => order.id);
    if (orderIds.length === 0) return resolved;

    const { data: quizzes, error: quizzesError } = await db.from("quizzes").select("id").in("order_id", orderIds);
    if (quizzesError) throw quizzesError;
    for (const quiz of quizzes) resolved.add(quiz.id);
    return resolved;
  }

  async function removeDeliverableObjects(allQuizIds: Set<string>): Promise<void> {
    for (const quizId of allQuizIds) {
      const { data: objects, error: listError } = await db.storage.from(DELIVERABLES_BUCKET).list(quizId);
      if (listError) throw listError;
      if (!objects || objects.length === 0) continue;
      const { error: removeError } = await db.storage
        .from(DELIVERABLES_BUCKET)
        .remove(objects.map((object) => `${quizId}/${object.name}`));
      if (removeError) throw removeError;
    }
  }

  async function removeItems(): Promise<void> {
    if (itemIds.size === 0) return;
    const ids = [...itemIds];
    const { error: translationsError } = await db.from("item_translations").delete().in("item_id", ids);
    if (translationsError) throw translationsError;
    const { error: itemsError } = await db.from("items").delete().in("id", ids);
    if (itemsError) throw itemsError;
  }

  async function cleanup(): Promise<void> {
    if (emails.size === 0 && quizIds.size === 0 && itemIds.size === 0) return;
    const emailList = [...emails];

    const allQuizIds = await resolveQuizIds(emailList);
    await removeDeliverableObjects(allQuizIds);

    if (allQuizIds.size > 0) {
      const { error } = await db.from("quizzes").delete().in("id", [...allQuizIds]);
      if (error) throw error;
    }
    if (emailList.length > 0) {
      const { error: ordersError } = await db.from("orders").delete().in("billing_email", emailList);
      if (ordersError) throw ordersError;
      const { error: compositionsError } = await db.from("compositions").delete().in("billing_email", emailList);
      if (compositionsError) throw compositionsError;
    }
    await removeItems();

    emails.clear();
    quizIds.clear();
    itemIds.clear();
  }

  return { trackEmail, trackQuizId, trackItemId, cleanup };
}
