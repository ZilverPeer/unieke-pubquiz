import type { QuizContent } from "@/domain";

/** Renders the one-page Answer sheet PDF. Implemented in ticket #9. */
export async function renderAnswerSheetPdf(_quiz: QuizContent): Promise<Buffer> {
  throw new Error("renderAnswerSheetPdf is implemented in ticket #9");
}
