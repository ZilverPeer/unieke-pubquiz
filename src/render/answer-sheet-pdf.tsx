import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { MessageKey, QuizContent } from "@/domain";
import { message } from "@/domain";
import { MusicRoundSection } from "./answer-sheet/MusicRoundSection";
import { PAGE_HEIGHT, PAGE_MARGIN, PAGE_WIDTH } from "./answer-sheet/layout";
import { TextRoundSection } from "./answer-sheet/TextRoundSection";
import { PDF_FONT_FAMILY } from "./pdf/shell";

const ROUND_HEADING_KEYS: readonly MessageKey[] = [
  "roundHeading1",
  "roundHeading2",
  "roundHeading3",
  "roundHeading4",
  "roundHeading5",
  "roundHeading6",
];

const styles = StyleSheet.create({
  page: {
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    padding: PAGE_MARGIN,
    fontFamily: PDF_FONT_FAMILY,
  },
  row: {
    flexDirection: "row",
  },
  heading: {
    position: "absolute",
    top: 1,
    left: 0,
    right: 0,
    fontSize: 6,
    textAlign: "center",
    color: "#666666",
  },
});

/**
 * Renders the one-page landscape Answer sheet PDF: a 4-column x 2-row grid
 * — row 1 holds four Text Round sections, row 2 holds the remaining two
 * Text Round sections plus the Music Round section spanning the last two
 * columns — with dashed cut lines between every section.
 */
export async function renderAnswerSheetPdf(quiz: QuizContent): Promise<Buffer> {
  const { locale, rounds } = quiz;
  const textRounds = rounds.filter((round) => round.kind === "text");
  const musicRound = rounds.find((round) => round.kind === "music");

  if (textRounds.length !== ROUND_HEADING_KEYS.length || !musicRound) {
    throw new Error("QuizContent must have six Text Rounds and one Music Round");
  }

  const answerSheetHeading = message(locale, "answerSheetHeading");
  const teamNameLabel = message(locale, "teamNameLabel");
  const musicRoundHeading = message(locale, "musicRoundHeading");
  const artistLabel = message(locale, "artistLabel");
  const titleLabel = message(locale, "titleLabel");

  const textSectionFor = (round: (typeof textRounds)[number]) => {
    const headingKey = ROUND_HEADING_KEYS[round.slotIndex];
    const heading = `${message(locale, headingKey)}: ${round.categoryName}`;
    return (
      <TextRoundSection key={round.slotIndex} heading={heading} teamNameLabel={teamNameLabel} />
    );
  };

  return renderToBuffer(
    <Document>
      <Page size={[PAGE_WIDTH, PAGE_HEIGHT]} style={styles.page} wrap={false}>
        <Text style={styles.heading} fixed>
          {answerSheetHeading}
        </Text>
        <View style={styles.row} wrap={false}>{textRounds.slice(0, 4).map(textSectionFor)}</View>
        <View style={styles.row} wrap={false}>
          {textRounds.slice(4, 6).map(textSectionFor)}
          <MusicRoundSection
            heading={`${musicRoundHeading}: ${musicRound.categoryName}`}
            teamNameLabel={teamNameLabel}
            artistLabel={artistLabel}
            titleLabel={titleLabel}
          />
        </View>
      </Page>
    </Document>,
  );
}
