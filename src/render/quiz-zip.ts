/**
 * Zips a Quiz's four rendered Deliverables into one archive (ticket #73):
 * this is the render module's Deliverable output now, in place of the four
 * loose files it used to hand back separately. Entry names are exactly the
 * four fixed Deliverable file names (unrelated to the Storage/download
 * object's own name, a single `quiz.zip` per Quiz -- see
 * quizZipFilename/DELIVERABLE_FILES in src/domain/orders.ts, which describe
 * this archive's *container*, not its contents).
 *
 * `GeneratedQuizFiles` (src/scripts/generate-quiz.ts) is imported type-only:
 * erased at compile time, so it never creates a runtime dependency from
 * render on scripts (render "may import only src/domain", README.md) --
 * only a structural shape both sides agree on.
 */
import { zipSync } from "fflate";
import type { GeneratedQuizFiles } from "@/scripts/generate-quiz";

export function buildQuizZip(files: GeneratedQuizFiles): Uint8Array {
  return zipSync({
    "quizmaster.pdf": files["quizmaster.pdf"],
    "picture-handout.pdf": files["picture-handout.pdf"],
    "answer-sheet.pdf": files["answer-sheet.pdf"],
    "music-round.mp3": files["music-round.mp3"],
  });
}
