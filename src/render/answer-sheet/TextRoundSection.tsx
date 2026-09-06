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
});

export interface TextRoundSectionProps {
  /** The Round heading and Category name, already resolved to the Quiz Locale. */
  heading: string;
  /** The "team name" label, resolved to the Quiz Locale. */
  teamNameLabel: string;
}

/**
 * One grid-cell section for a Text Round: the heading and the team-name
 * field share a header line (the heading wraps to a second line instead of
 * clipping when a long Category name doesn't fit), followed by 10 numbered
 * answer rows stacked in one column, each a full-width ruled line.
 */
export function TextRoundSection({ heading, teamNameLabel }: TextRoundSectionProps) {
  const numbers = Array.from({ length: ITEM_COUNT }, (_, i) => i + 1);

  return (
    <View style={[sectionStyles.cell, styles.cell]} wrap={false}>
      <View style={sectionStyles.header} wrap={false}>
        <Text style={sectionStyles.heading}>{heading}</Text>
        <View style={sectionStyles.teamNameGroup} wrap={false}>
          <Text style={sectionStyles.teamNameLabel}>{teamNameLabel}:</Text>
          <View style={sectionStyles.teamNameLine} />
        </View>
      </View>
      <View style={styles.answerColumn} wrap={false}>
        {numbers.map((n) => (
          <View key={n} style={sectionStyles.answerRow} wrap={false}>
            <Text style={sectionStyles.answerNumber}>{n}.</Text>
            <View style={sectionStyles.answerLine} />
          </View>
        ))}
      </View>
    </View>
  );
}
