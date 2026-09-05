import { StyleSheet, Text, View } from "@react-pdf/renderer";
import { PDF_FONT_FAMILY } from "../pdf/shell";
import { PAGE_WIDTH, PAGE_MARGIN, ROW_HEIGHT } from "./layout";

const ITEM_COUNT = 10;
const CELL_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

const styles = StyleSheet.create({
  cell: {
    width: CELL_WIDTH,
    height: ROW_HEIGHT,
    borderStyle: "dashed",
    borderWidth: 1,
    borderColor: "#000000",
    padding: 6,
    fontFamily: PDF_FONT_FAMILY,
  },
  heading: {
    fontSize: 9,
    fontWeight: "bold",
    marginBottom: 3,
  },
  teamName: {
    fontSize: 8,
    marginBottom: 4,
  },
  headerRow: {
    flexDirection: "row",
    fontSize: 7,
    fontWeight: "bold",
    marginBottom: 2,
  },
  numberColumn: {
    width: "10%",
  },
  fieldColumn: {
    width: "45%",
  },
  dataRow: {
    flexDirection: "row",
    fontSize: 7,
  },
});

export interface MusicRoundSectionProps {
  /** The Music Round heading and Category name, already resolved to the Quiz Locale. */
  heading: string;
  /** The "team name" label, resolved to the Quiz Locale. */
  teamNameLabel: string;
  /** The artist column header, resolved to the Quiz Locale. */
  artistLabel: string;
  /** The title column header, resolved to the Quiz Locale. */
  titleLabel: string;
}

/**
 * One quarter-page section for the Music Round: a heading line, a
 * team-name field, and 10 numbered rows with an Artist and a Title field.
 */
export function MusicRoundSection({
  heading,
  teamNameLabel,
  artistLabel,
  titleLabel,
}: MusicRoundSectionProps) {
  const numbers = Array.from({ length: ITEM_COUNT }, (_, i) => i + 1);

  return (
    <View style={styles.cell} wrap={false}>
      <Text style={styles.heading}>{heading}</Text>
      <Text style={styles.teamName}>{teamNameLabel}: ______________</Text>
      <View style={styles.headerRow} wrap={false}>
        <Text style={styles.numberColumn}> </Text>
        <Text style={styles.fieldColumn}>{artistLabel}</Text>
        <Text style={styles.fieldColumn}>{titleLabel}</Text>
      </View>
      {numbers.map((n) => (
        <View key={n} style={styles.dataRow} wrap={false}>
          <Text style={styles.numberColumn}>{n}.</Text>
          <Text style={styles.fieldColumn}>________________________</Text>
          <Text style={styles.fieldColumn}>________________________</Text>
        </View>
      ))}
    </View>
  );
}
