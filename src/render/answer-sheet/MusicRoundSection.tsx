import { StyleSheet, Text, View } from "@react-pdf/renderer";
import { wrapLongRuns } from "../pdf/hyphenation";
import { CELL_WIDTH } from "./layout";
import { sectionStyles } from "./section-styles";

const ITEMS_PER_COLUMN = 5;
/** The Music Round section spans the last two grid columns, not the full page width. */
const SECTION_WIDTH = CELL_WIDTH * 2;

const styles = StyleSheet.create({
  cell: {
    width: SECTION_WIDTH,
  },
  entryColumns: {
    flexDirection: "row",
    flexGrow: 1,
  },
  entryColumn: {
    width: "50%",
    flexDirection: "column",
    justifyContent: "space-between",
  },
  entry: {
    flexDirection: "column",
  },
  fieldLabel: {
    fontSize: 9,
    marginRight: 4,
  },
  titleRow: {
    marginLeft: 14,
  },
});

export interface MusicRoundSectionProps {
  /** The Music Round heading and Category name, already resolved to the Quiz Locale. */
  heading: string;
  /** The "team name" label, resolved to the Quiz Locale. */
  teamNameLabel: string;
  /** The artist field label, resolved to the Quiz Locale. */
  artistLabel: string;
  /** The title field label, resolved to the Quiz Locale. */
  titleLabel: string;
}

/**
 * The Music Round section, spanning two grid columns: the heading and the
 * team-name field share a header line (see TextRoundSection for the
 * long-heading fallback), followed by 10 numbered entries in two columns
 * of 5, each entry showing its Artist and Title fields on two ruled lines.
 */
export function MusicRoundSection({
  heading,
  teamNameLabel,
  artistLabel,
  titleLabel,
}: MusicRoundSectionProps) {
  const leftNumbers = Array.from({ length: ITEMS_PER_COLUMN }, (_, i) => i + 1);
  const rightNumbers = Array.from({ length: ITEMS_PER_COLUMN }, (_, i) => i + 1 + ITEMS_PER_COLUMN);

  const renderEntry = (n: number) => (
    <View key={n} style={styles.entry} wrap={false}>
      <View style={sectionStyles.answerRow} wrap={false}>
        <Text style={sectionStyles.answerNumber}>{n}.</Text>
        <Text style={styles.fieldLabel}>{artistLabel}:</Text>
        <View style={sectionStyles.answerLine} />
      </View>
      <View style={[sectionStyles.answerRow, styles.titleRow]} wrap={false}>
        <Text style={styles.fieldLabel}>{titleLabel}:</Text>
        <View style={sectionStyles.answerLine} />
      </View>
    </View>
  );

  return (
    <View style={[sectionStyles.cell, styles.cell]} wrap={false}>
      <View style={sectionStyles.header} wrap={false}>
        <Text style={sectionStyles.heading} hyphenationCallback={wrapLongRuns}>
          {heading}
        </Text>
        <View style={sectionStyles.teamNameGroup} wrap={false}>
          <Text style={sectionStyles.teamNameLabel}>{teamNameLabel}:</Text>
          <View style={sectionStyles.teamNameLine} />
        </View>
      </View>
      <View style={styles.entryColumns} wrap={false}>
        <View style={styles.entryColumn} wrap={false}>
          {leftNumbers.map(renderEntry)}
        </View>
        <View style={styles.entryColumn} wrap={false}>
          {rightNumbers.map(renderEntry)}
        </View>
      </View>
    </View>
  );
}
