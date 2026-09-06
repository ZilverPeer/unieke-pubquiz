/**
 * Content repository: the only module that talks to Postgres and Storage
 * (via Supabase). Loads the sampleable Item pool for a Locale, loads a
 * billing email's excluded Item ids (the no-repeat rule), and persists a
 * Composition. May import only src/domain and supabase-js.
 * See README.md.
 */
import type { CompositionRecord, Locale, OrderRecord, QuizRecord, QuizStatus } from "@/domain";
import { createSupabaseClient, type RepositoryConfig } from "./client";
import {
  loadExcludedItemIds as loadExcludedItemIdsImpl,
  persistComposition as persistCompositionImpl,
} from "./compositions";
import {
  clearDownloadToken as clearDownloadTokenImpl,
  getQuizByDownloadToken as getQuizByDownloadTokenImpl,
  getQuizById as getQuizByIdImpl,
  listPendingQuizzes as listPendingQuizzesImpl,
  listQuizzesByBillingEmail as listQuizzesByBillingEmailImpl,
  listQuizzesDeliveredBefore as listQuizzesDeliveredBeforeImpl,
  recordDelivery as recordDeliveryImpl,
  transitionQuizStatus as transitionQuizStatusImpl,
  upsertOrder as upsertOrderImpl,
  type RecordDeliveryInput,
  type TransitionQuizStatusOptions,
  type UpsertOrderInput,
} from "./orders";
import { loadPool as loadPoolImpl } from "./pool";
import { downloadFromBucket } from "./storage";
import type { PoolEntry } from "./types";

export type { RepositoryConfig } from "./client";
export type { ItemTranslation, PoolEntry } from "./types";
export {
  IllegalQuizTransitionError,
  QuizStatusChangedConcurrentlyError,
  type OrderLineItem,
  type RecordDeliveryInput,
  type TransitionQuizStatusOptions,
  type UpsertOrderInput,
} from "./orders";
// Local-dev only: resolves the local Supabase stack's connection config for
// dev scripts and integration tests. See local-stack-config.ts.
export { resolveLocalStackConfig } from "./local-stack-config";

export interface ContentRepository {
  loadPool(locale: Locale): Promise<PoolEntry[]>;
  loadExcludedItemIds(billingEmail: string): Promise<Set<string>>;
  persistComposition(record: CompositionRecord): Promise<{ compositionId: string }>;
  downloadPicture(storagePath: string): Promise<Uint8Array>;
  downloadMusicClip(storagePath: string): Promise<Uint8Array>;
}

export function createRepository(config: RepositoryConfig): ContentRepository {
  const client = createSupabaseClient(config);

  return {
    loadPool: (locale) => loadPoolImpl(client, locale),
    loadExcludedItemIds: (billingEmail) => loadExcludedItemIdsImpl(client, billingEmail),
    persistComposition: (record) => persistCompositionImpl(client, record),
    downloadPicture: (storagePath) => downloadFromBucket(client, "pictures", storagePath),
    downloadMusicClip: (storagePath) => downloadFromBucket(client, "music-clips", storagePath),
  };
}

/**
 * Order and Quiz persistence -- a sibling of ContentRepository rather than
 * folded into it (see README.md "Order repository"): orders/Quizzes are not
 * content, they're what the webhook (#39) and worker (#40) act on, and
 * keeping them separate avoids ContentRepository (used by sample/render-side
 * code) growing methods those callers never need.
 */
export interface OrderRepository {
  upsertOrder(input: UpsertOrderInput): Promise<{ order: OrderRecord; quizzes: QuizRecord[] }>;
  transitionQuizStatus(
    quizId: string,
    to: QuizStatus,
    options?: TransitionQuizStatusOptions,
  ): Promise<QuizRecord>;
  recordDelivery(quizId: string, input: RecordDeliveryInput): Promise<QuizRecord>;
  clearDownloadToken(quizId: string): Promise<void>;
  listQuizzesByBillingEmail(billingEmail: string): Promise<QuizRecord[]>;
  listQuizzesDeliveredBefore(cutoff: Date): Promise<QuizRecord[]>;
  getQuizById(quizId: string): Promise<QuizRecord | null>;
  getQuizByDownloadToken(downloadToken: string): Promise<QuizRecord | null>;
  listPendingQuizzes(): Promise<QuizRecord[]>;
}

export function createOrderRepository(config: RepositoryConfig): OrderRepository {
  const client = createSupabaseClient(config);

  return {
    upsertOrder: (input) => upsertOrderImpl(client, input),
    transitionQuizStatus: (quizId, to, options) => transitionQuizStatusImpl(client, quizId, to, options),
    recordDelivery: (quizId, input) => recordDeliveryImpl(client, quizId, input),
    clearDownloadToken: (quizId) => clearDownloadTokenImpl(client, quizId),
    listQuizzesByBillingEmail: (billingEmail) => listQuizzesByBillingEmailImpl(client, billingEmail),
    listQuizzesDeliveredBefore: (cutoff) => listQuizzesDeliveredBeforeImpl(client, cutoff),
    getQuizById: (quizId) => getQuizByIdImpl(client, quizId),
    getQuizByDownloadToken: (downloadToken) => getQuizByDownloadTokenImpl(client, downloadToken),
    listPendingQuizzes: () => listPendingQuizzesImpl(client),
  };
}
