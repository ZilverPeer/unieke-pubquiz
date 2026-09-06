import { StyleSheet, Text, View } from "@react-pdf/renderer";
import { CELL_WIDTH } from "./layout";
import { sectionStyles } from "./section-styles";

const ITEM_COUNT = 10;

const styles = StyleSheet.create({
  cell: {
    width: CELL_WIDTH,
  },
  answerColumn: {
    flexDirection: "column",
    flexGrow: 1,
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
 * One grid-cell section for a Text Round: the heading and the team-name
 * field share a single header line, followed by 10 numbered answer lines
 * stacked in one column.
 */
export function TextRoundSection({ heading, teamNameLabel }: TextRoundSectionProps) {
  const numbers = Array.from({ length: ITEM_COUNT }, (_, i) => i + 1);

  return (
    <View style={[sectionStyles.cell, styles.cell]} wrap={false}>
      <View style={sectionStyles.header} wrap={false}>
        <Text style={sectionStyles.heading}>{heading}</Text>
        <Text style={sectionStyles.teamName}>{teamNameLabel}: ______________</Text>
      </View>
      <View style={styles.answerColumn} wrap={false}>
        {numbers.map((n) => (
          <Text key={n} style={styles.answerLine}>
            {n}. ________________________
          </Text>
        ))}
      </View>
    </View>
  );
}
