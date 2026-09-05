import type { QuizContent } from "@/domain";

/** Renders the Picture Round handout PDF (slot 6). Implemented in ticket #8. */
export async function renderPictureHandoutPdf(_quiz: QuizContent): Promise<Buffer> {
  throw new Error("renderPictureHandoutPdf is implemented in ticket #8");
}
