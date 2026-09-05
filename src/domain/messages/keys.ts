/** Round headings and Deliverable labels, one entry per Locale in ./nl.ts and ./en.ts. */
export interface Messages {
  roundHeading1: string;
  roundHeading2: string;
  roundHeading3: string;
  roundHeading4: string;
  roundHeading5: string;
  roundHeading6: string;
  pictureRoundHeading: string;
  musicRoundHeading: string;
  quizmasterPdfLabel: string;
  pictureHandoutPdfLabel: string;
  answerSheetPdfLabel: string;
  musicRoundMp3Label: string;
  /** Labels used inside the Deliverables (tickets #7-#10). */
  quizmasterHeading: string;
  questionLabel: string;
  answerLabel: string;
  factLabel: string;
  artistLabel: string;
  titleLabel: string;
  teamNameLabel: string;
  answerSheetHeading: string;
  pictureHandoutInstruction: string;
}

export type MessageKey = keyof Messages;
