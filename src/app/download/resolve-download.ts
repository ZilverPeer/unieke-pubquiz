/**
 * Pure decision function behind the download route (ticket #42, path pinned
 * by downloadPath() in src/domain/orders.ts). Kept out of route.ts so it can
 * be driven directly in tests with fakes for both seams -- the token lookup
 * (OrderRepository.getQuizByDownloadToken) and the bucket read
 * (a DownloadDeliverable from src/repository/storage.ts).
 */
import { DELIVERABLE_CONTENT_TYPES, DELIVERABLE_FILES, type DeliverableFile } from "@/domain";

/** The subset of QuizRecord this function needs -- just enough to build the storage path and check pruning. */
export interface DownloadQuizLookup {
  id: string;
  /** Set once the pruning job has deleted this Quiz's objects -- see markPruned (src/repository/orders.ts). */
  prunedAt: string | null;
}

export interface ResolveDownloadDeps {
  getQuizByDownloadToken(token: string): Promise<DownloadQuizLookup | null>;
  /** Throws (any error) when the object is missing from the bucket -- see storage.ts's downloadFromBucket. */
  downloadDeliverable(storagePath: string): Promise<Uint8Array>;
}

export type ResolveDownloadResult =
  | { status: 200; body: Uint8Array; contentType: string; filename: DeliverableFile }
  | { status: 404 }
  | { status: 410 };

function isDeliverableFile(file: string): file is DeliverableFile {
  return (DELIVERABLE_FILES as readonly string[]).includes(file);
}

/**
 * Resolves one download request to a plain result the route can turn into a
 * Response: 404 for a file name outside DELIVERABLE_FILES or an unknown
 * token, 410 once the token is known but its Quiz has been pruned
 * (`prunedAt` set -- the pruning job keeps the token precisely so this
 * branch stays reachable, see CONTEXT.md "Orders and Quizzes") or the
 * object is otherwise missing from the bucket, 200 with the object's bytes
 * otherwise.
 */
export async function resolveDownload(
  token: string,
  file: string,
  deps: ResolveDownloadDeps,
): Promise<ResolveDownloadResult> {
  if (!isDeliverableFile(file)) {
    return { status: 404 };
  }

  const quiz = await deps.getQuizByDownloadToken(token);
  if (!quiz) {
    return { status: 404 };
  }

  if (quiz.prunedAt) {
    return { status: 410 };
  }

  let body: Uint8Array;
  try {
    body = await deps.downloadDeliverable(`${quiz.id}/${file}`);
  } catch {
    return { status: 410 };
  }

  return { status: 200, body, contentType: DELIVERABLE_CONTENT_TYPES[file], filename: file };
}
