import { StyleSheet, Text, View } from "@react-pdf/renderer";
import { CELL_WIDTH } from "./layout";
import { sectionStyles } from "./section-styles";

const ITEMS_PER_COLUMN = 5;

const styles = StyleSheet.create({
  cell: {
    width: CELL_WIDTH,
  },
  answerColumns: {
    flexDirection: "row",
    flexGrow: 1,
  },
  answerColumn: {
    width: "50%",
    flexDirection: "column",
    justifyContent: "space-between",
  },
  answerLine: {
    fontSize: 7,
    flexDirection: "row",
  },
});

export interface TextRoundSectionProps {
  /** The Round heading and Category name, already resolved to the Quiz Locale. */
  heading: string;
  /** The "team name" label, resolved to the Quiz Locale. */
  teamNameLabel: string;
}

/**
 * One eighth-page section for a Text Round: a heading line, a team-name
 * field, and 10 numbered answer lines in two columns of 5.
 */
export function TextRoundSection({ heading, teamNameLabel }: TextRoundSectionProps) {
  const leftNumbers = Array.from({ length: ITEMS_PER_COLUMN }, (_, i) => i + 1);
  const rightNumbers = Array.from({ length: ITEMS_PER_COLUMN }, (_, i) => i + 1 + ITEMS_PER_COLUMN);

  return (
    <View style={[sectionStyles.cell, styles.cell]} wrap={false}>
      <Text style={sectionStyles.heading}>{heading}</Text>
      <Text style={sectionStyles.teamName}>{teamNameLabel}: ______________</Text>
      <View style={styles.answerColumns} wrap={false}>
        <View style={styles.answerColumn} wrap={false}>
          {leftNumbers.map((n) => (
            <Text key={n} style={styles.answerLine}>
              {n}. ________________________
            </Text>
          ))}
        </View>
        <View style={styles.answerColumn} wrap={false}>
          {rightNumbers.map((n) => (
            <Text key={n} style={styles.answerLine}>
              {n}. ________________________
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}
