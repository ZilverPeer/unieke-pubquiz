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
  getCompositionById as getCompositionByIdImpl,
  loadExcludedItemIds as loadExcludedItemIdsImpl,
  persistComposition as persistCompositionImpl,
} from "./compositions";
import {
  clearDownloadToken as clearDownloadTokenImpl,
  getOrderById as getOrderByIdImpl,
  getQuizByCompositionId as getQuizByCompositionIdImpl,
  getQuizByDownloadToken as getQuizByDownloadTokenImpl,
  getQuizById as getQuizByIdImpl,
  listFailedQuizzes as listFailedQuizzesImpl,
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
import { deleteFromDeliverablesBucket, downloadFromBucket, uploadToDeliverablesBucket } from "./storage";
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
  /** Added for the `--composition` dev script flag (ticket #42): re-rendering never re-samples. */
  getCompositionById(compositionId: string): Promise<CompositionRecord | null>;
  downloadPicture(storagePath: string): Promise<Uint8Array>;
  downloadMusicClip(storagePath: string): Promise<Uint8Array>;
}

export function createRepository(config: RepositoryConfig): ContentRepository {
  const client = createSupabaseClient(config);

  return {
    loadPool: (locale) => loadPoolImpl(client, locale),
    loadExcludedItemIds: (billingEmail) => loadExcludedItemIdsImpl(client, billingEmail),
    persistComposition: (record) => persistCompositionImpl(client, record),
    getCompositionById: (compositionId) => getCompositionByIdImpl(client, compositionId),
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
  /** Added for the worker (ticket #40): generateQuiz needs the order's billing email. */
  getOrderById(orderId: string): Promise<OrderRecord | null>;
  /** Added for the pruning job (ticket #42): leftover objects of a failed Quiz need cleanup too. */
  listFailedQuizzes(): Promise<QuizRecord[]>;
  /** Added for the `--composition` dev script flag (ticket #42): finds the Quiz to re-attach files to. */
  getQuizByCompositionId(compositionId: string): Promise<QuizRecord | null>;
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
    getOrderById: (orderId) => getOrderByIdImpl(client, orderId),
    listFailedQuizzes: () => listFailedQuizzesImpl(client),
    getQuizByCompositionId: (compositionId) => getQuizByCompositionIdImpl(client, compositionId),
  };
}

/**
 * Uploads to the private `deliverables` bucket -- a sibling factory, not a
 * method on ContentRepository or OrderRepository (spec #36, ticket #40): it's
 * needed only by the worker's write side, and neither existing repository
 * has a reason to grow a Storage write method the sample/render/order code
 * paths never call.
 */
export type UploadDeliverable = (storagePath: string, data: Uint8Array, contentType: string) => Promise<void>;

export function createDeliverableUploader(config: RepositoryConfig): UploadDeliverable {
  const client = createSupabaseClient(config);
  return (storagePath, data, contentType) => uploadToDeliverablesBucket(client, storagePath, data, contentType);
}

/**
 * Reads one object from the private `deliverables` bucket -- a sibling
 * factory of createDeliverableUploader, for the download route (ticket #42).
 * Throws when the object is missing (see storage.ts's downloadFromBucket);
 * the route's resolveDownload turns that into a 410.
 */
export type DownloadDeliverable = (storagePath: string) => Promise<Uint8Array>;

export function createDeliverableDownloader(config: RepositoryConfig): DownloadDeliverable {
  const client = createSupabaseClient(config);
  return (storagePath) => downloadFromBucket(client, "deliverables", storagePath);
}

/**
 * Deletes objects from the private `deliverables` bucket -- for the daily
 * pruning job (ticket #42). A sibling factory rather than a method on
 * OrderRepository: it's Storage, not a Postgres write, matching
 * createDeliverableUploader/createDeliverableDownloader's own shape.
 */
export type RemoveDeliverables = (storagePaths: readonly string[]) => Promise<void>;

export function createDeliverableRemover(config: RepositoryConfig): RemoveDeliverables {
  const client = createSupabaseClient(config);
  return (storagePaths) => deleteFromDeliverablesBucket(client, storagePaths);
}
