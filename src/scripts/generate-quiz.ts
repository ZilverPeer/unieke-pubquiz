/**
 * Orchestrates one full Quiz generation: load pool + exclusions, sample,
 * assemble content, render all four Deliverables, deliver them via the
 * injected `writeDeliverables`, and persist the Composition LAST -- after
 * every Deliverable has been written -- so a render or delivery failure
 * consumes no Items. No process.exit here -- see src/scripts/generate.ts
 * for the CLI entry point.
 */
import type { CompositionRecord, GenerationFailure } from "@/domain";
import { createSeededRandom, sampleComposition } from "@/sample";
import type { ContentRepository } from "@/repository";
import {
  renderAnswerSheetPdf,
  renderMusicRoundMp3,
  renderPictureHandoutPdf,
  renderQuizmasterPdf,
} from "@/render";
import { assembleQuizContent } from "./assemble-quiz-content";
import type { GenerateOptions } from "./cli-args";

export interface GeneratedQuizFiles {
  "quizmaster.pdf": Buffer;
  "picture-handout.pdf": Buffer;
  "answer-sheet.pdf": Buffer;
  "music-round.mp3": Buffer;
}

export type GenerateQuizResult =
  | {
      ok: true;
      files: GeneratedQuizFiles;
      compositionRecord: CompositionRecord;
      compositionId: string;
    }
  | {
      ok: false;
      failure: GenerationFailure;
      /** The failed slot's Category name, or the raw id if unknown, or "none". */
      categoryLabel: string;
    };

/**
 * Delivers the four rendered files (e.g. writes them to disk). Called after
 * rendering and before persisting -- see generateQuiz below. A rejection
 * here (nothing written, or only partially written) must stop generateQuiz
 * from persisting, so it is never swallowed.
 */
export type WriteDeliverables = (files: GeneratedQuizFiles) => Promise<void>;

export async function generateQuiz(
  options: GenerateOptions,
  repository: ContentRepository,
  writeDeliverables: WriteDeliverables,
): Promise<GenerateQuizResult> {
  // `out` (the output folder) is only meaningful to generate.ts's file
  // writing; this function never touches the filesystem.
  const { seed, quizMode, categoryPicks, requestedDifficulty, billingEmail, locale } = options;
  const request = { quizMode, categoryPicks, requestedDifficulty, billingEmail, locale };

  const pool = await repository.loadPool(request.locale);
  const excludedItemIds = await repository.loadExcludedItemIds(request.billingEmail);

  const sampleResult = sampleComposition({
    request,
    pool: pool.map((entry) => entry.item),
    excludedItemIds,
    random: createSeededRandom(seed),
  });

  if (!sampleResult.ok) {
    const { failure } = sampleResult;
    let categoryLabel = "none";
    if (failure.categoryId !== null) {
      const entry = pool.find((e) => e.item.categoryId === failure.categoryId);
      categoryLabel = entry?.categoryName ?? failure.categoryId;
    }
    return { ok: false, failure, categoryLabel };
  }

  const entriesById = new Map(pool.map((entry) => [entry.item.id, entry]));
  const quizContent = await assembleQuizContent(sampleResult.composition, request.locale, entriesById, {
    picture: (storagePath) => repository.downloadPicture(storagePath),
    music: (storagePath) => repository.downloadMusicClip(storagePath),
  });

  const files: GeneratedQuizFiles = {
    "quizmaster.pdf": await renderQuizmasterPdf(quizContent),
    "picture-handout.pdf": await renderPictureHandoutPdf(quizContent),
    "answer-sheet.pdf": await renderAnswerSheetPdf(quizContent),
    "music-round.mp3": await renderMusicRoundMp3(quizContent),
  };

  // Deliver before persisting: if writing fails, this rejects and
  // persistComposition below never runs, so a delivery failure never
  // consumes Items a customer could otherwise still receive.
  await writeDeliverables(files);

  const compositionRecord: CompositionRecord = {
    billingEmail: request.billingEmail,
    locale: request.locale,
    quizMode: request.quizMode,
    requestedDifficulty: request.requestedDifficulty,
    seed,
    composition: sampleResult.composition,
  };

  const { compositionId } = await repository.persistComposition(compositionRecord);

  return { ok: true, files, compositionRecord, compositionId };
}
