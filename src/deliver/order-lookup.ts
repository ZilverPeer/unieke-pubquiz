/**
 * Adapter over the repository's OrderRepository (spec #36, ticket #41): the
 * only file in src/deliver that imports @/repository. Everything else in
 * this module talks only to WooCommerce and to this small OrderLookup seam,
 * so the module never sees Items or Compositions (README.md).
 */
import type { QuizStatus } from "@/domain";
import type { OrderRepository } from "@/repository";

/** What deliverQuiz/noteFailure need to know about a Quiz's WooCommerce order. */
export interface QuizOrderContext {
  wooOrderId: number;
  wooLineItemId: number;
  /** Status of every Quiz belonging to the order, this one included. */
  siblingStatuses: readonly QuizStatus[];
}

export interface OrderLookup {
  forQuiz(quizId: string): Promise<QuizOrderContext>;
}

/** Wraps an OrderRepository (src/repository) as the small lookup the deliver module needs. */
export function createOrderLookup(repository: OrderRepository): OrderLookup {
  return {
    async forQuiz(quizId) {
      const quiz = await repository.getQuizById(quizId);
      if (!quiz) {
        throw new Error(`deliver: Quiz ${quizId} not found`);
      }

      const order = await repository.getOrderById(quiz.orderId);
      if (!order) {
        throw new Error(`deliver: order ${quiz.orderId} not found for Quiz ${quizId}`);
      }

      const siblings = await repository.listQuizzesByOrderId(quiz.orderId);

      return {
        wooOrderId: order.wooOrderId,
        wooLineItemId: quiz.wooLineItemId,
        siblingStatuses: siblings.map((sibling) => sibling.status),
      };
    },
  };
}
