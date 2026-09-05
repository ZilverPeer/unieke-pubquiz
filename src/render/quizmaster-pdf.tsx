import { Document, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { ItemContent, MessageKey, QuizContent, RoundContent } from "@/domain";
import { message } from "@/domain";
import { PDF_FONT_FAMILY, PdfPage } from "./pdf/shell";

/** Message key for the round heading of each of the 8 slots, by slot index. */
const ROUND_HEADING_KEYS: readonly MessageKey[] = [
  "roundHeading1",
  "roundHeading2",
  "roundHeading3",
  "roundHeading4",
  "roundHeading5",
  "roundHeading6",
  "pictureRoundHeading",
  "musicRoundHeading",
];

const styles = StyleSheet.create({
  heading: {
    fontFamily: PDF_FONT_FAMILY,
    fontSize: 14,
    fontWeight: "bold",
    marginBottom: 4,
  },
  subheading: {
    fontFamily: PDF_FONT_FAMILY,
    fontSize: 10,
    marginBottom: 10,
  },
  item: {
    marginBottom: 6,
  },
  line: {
    fontFamily: PDF_FONT_FAMILY,
    fontSize: 10,
  },
});

function itemLines(item: ItemContent, position: number, locale: QuizContent["locale"]): string[] {
  const number = position + 1;
  const lines =
    item.kind === "text"
      ? [
          `${number}. ${message(locale, "questionLabel")}: ${item.question}`,
          `${message(locale, "answerLabel")}: ${item.answer}`,
        ]
      : item.kind === "picture"
        ? [`${number}. ${message(locale, "answerLabel")}: ${item.answer}`]
        : [
            `${number}. ${message(locale, "artistLabel")}: ${item.artist}`,
            `${message(locale, "titleLabel")}: ${item.title}`,
          ];
  if (item.fact) lines.push(`${message(locale, "factLabel")}: ${item.fact}`);
  return lines;
}

function RoundPage({ round, locale }: { round: RoundContent; locale: QuizContent["locale"] }) {
  const headingKey = ROUND_HEADING_KEYS[round.slotIndex];
  return (
    <PdfPage>
      <Text style={styles.subheading}>{message(locale, "quizmasterHeading")}</Text>
      <Text style={styles.heading}>
        {message(locale, headingKey)}: {round.categoryName}
      </Text>
      {round.items.map((item, position) => (
        <View style={styles.item} key={item.id}>
          {itemLines(item, position, locale).map((line, lineIndex) => (
            <Text style={styles.line} key={lineIndex}>
              {line}
            </Text>
          ))}
        </View>
      ))}
    </PdfPage>
  );
}

/** Renders the Quizmaster PDF for the whole Quiz: one Round per page, in slot order. */
export async function renderQuizmasterPdf(quiz: QuizContent): Promise<Buffer> {
  return renderToBuffer(
    <Document>
      {quiz.rounds.map((round) => (
        <RoundPage round={round} locale={quiz.locale} key={round.slotIndex} />
      ))}
    </Document>,
  );
}
