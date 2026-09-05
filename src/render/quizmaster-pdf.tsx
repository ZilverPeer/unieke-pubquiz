import type { QuizContent } from "@/domain";

/** Renders the Quizmaster PDF for the whole Quiz. Implemented in ticket #7. */
export async function renderQuizmasterPdf(_quiz: QuizContent): Promise<Buffer> {
  throw new Error("renderQuizmasterPdf is implemented in ticket #7");
}
