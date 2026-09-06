import { StyleSheet, Text, View } from "@react-pdf/renderer";
import { PAGE_WIDTH, PAGE_MARGIN } from "./layout";
import { sectionStyles } from "./section-styles";

const ITEMS_PER_COLUMN = 5;
const CELL_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

const styles = StyleSheet.create({
  cell: {
    width: CELL_WIDTH,
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
    fontSize: 7,
  },
  entryNumber: {
    fontWeight: "bold",
  },
  entryLine: {
    flexDirection: "row",
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
 * The full-width Music Round row: the heading and the team-name field
 * share a single header line, followed by 10 numbered entries in two
 * columns of 5, each entry showing its Artist and Title fields stacked
 * on two lines.
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
      <Text style={styles.entryLine}>
        <Text style={styles.entryNumber}>{n}. </Text>
        {artistLabel}: ________________________
      </Text>
      <Text style={styles.entryLine}>{titleLabel}: ________________________</Text>
    </View>
  );

  return (
    <View style={[sectionStyles.cell, styles.cell]} wrap={false}>
      <View style={sectionStyles.header} wrap={false}>
        <Text style={sectionStyles.heading}>{heading}</Text>
        <Text style={sectionStyles.teamName}>{teamNameLabel}: ______________</Text>
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
