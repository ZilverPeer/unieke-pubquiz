import { StyleSheet } from "@react-pdf/renderer";
import { PDF_FONT_FAMILY } from "../pdf/shell";
import { ROW_HEIGHT } from "./layout";

/**
 * Minimum width (points) reserved for the team-name field (its label plus
 * a usable blank line) in every section header. The header row wraps
 * (`flexWrap: "wrap"`): the heading takes its natural width, and the
 * team-name group has `flexGrow` plus this `minWidth`, so a short heading
 * and the team-name field share one line with the blank line filling the
 * remainder, while a heading too wide to leave at least
 * MIN_TEAM_NAME_WIDTH on the same line pushes the whole team-name group
 * onto its own following line at full row width — the two never share a
 * line without enough room for both, so their boxes never overlap.
 */
export const MIN_TEAM_NAME_WIDTH = 90;

/** Horizontal and vertical inset applied inside every section's dashed-line cell. */
export const CELL_PADDING = 6;

/**
 * Styles shared by every Answer sheet section (Text Round and Music Round):
 * the dashed-cut-line cell frame, the header row (heading and team-name
 * field on one line, or two when the heading doesn't fit), the numbered
 * answer-line row, and the fonts they use. Width differs per section
 * (single grid cell vs two-cell-wide Music section), so it is applied by
 * the caller alongside `cell`.
 */
export const sectionStyles = StyleSheet.create({
  cell: {
    height: ROW_HEIGHT,
    borderStyle: "dashed",
    borderWidth: 1,
    borderColor: "#000000",
    padding: CELL_PADDING,
    fontFamily: PDF_FONT_FAMILY,
  },
  header: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
    marginBottom: 4,
  },
  heading: {
    fontSize: 9,
    fontWeight: "bold",
    maxWidth: "100%",
    marginRight: 8,
  },
  teamNameGroup: {
    flexDirection: "row",
    alignItems: "flex-end",
    flexGrow: 1,
    minWidth: MIN_TEAM_NAME_WIDTH,
  },
  teamNameLabel: {
    fontSize: 8,
    marginRight: 4,
  },
  teamNameLine: {
    flexGrow: 1,
    height: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#000000",
  },
  answerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
  },
  answerNumber: {
    fontSize: 9,
    marginRight: 4,
  },
  answerLine: {
    flexGrow: 1,
    height: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#000000",
  },
});
