import { StyleSheet } from "@react-pdf/renderer";
import { PDF_FONT_FAMILY } from "../pdf/shell";
import { ROW_HEIGHT } from "./layout";

/**
 * Minimum width (points) reserved for the team-name field (its label plus
 * a usable blank line) in every section header. The heading gets whatever
 * width is left: `flexShrink` on `heading` combined with `flexGrow` +
 * `minWidth` here means a short heading and the team-name field share one
 * line with the blank line filling the remainder, while a heading too wide
 * for the cell is squeezed until react-pdf's own text layout wraps it onto
 * a second line — no manual text-width estimation needed.
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
    alignItems: "flex-start",
    marginBottom: 4,
  },
  heading: {
    fontSize: 9,
    fontWeight: "bold",
    flexGrow: 0,
    flexShrink: 1,
    marginRight: 8,
  },
  teamNameGroup: {
    flexDirection: "row",
    alignItems: "flex-end",
    flexGrow: 1,
    flexShrink: 0,
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
