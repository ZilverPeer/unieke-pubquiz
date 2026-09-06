/**
 * deliver: Deliverables -> WooCommerce. Knows Quiz and order identifiers and
 * file URLs; never Items or Compositions (CONTEXT.md "Pipeline orthogonality").
 *
 * Interface pinned on master for spec #36. Implemented in #41; the worker (#40)
 * codes against this shape and tests with a stub.
 */
import type { DeliverableFile } from "@/domain";

export interface DeliveredFile {
  file: DeliverableFile;
  /** Absolute URL of the app download route for this file. */
  url: string;
}

export interface Deliverer {
  /** Attach the Quiz's files to its line item; complete the order once every Quiz of it is delivered. */
  deliverQuiz(input: { quizId: string; files: readonly DeliveredFile[] }): Promise<void>;
  /** Add a private operator note for a failed Quiz; leave the order status alone. */
  noteFailure(input: { quizId: string; reason: string }): Promise<void>;
}

export function createDeliverer(): Deliverer {
  throw new Error("deliver module not implemented yet (ticket #41)");
}
