import { StyleSheet } from "@react-pdf/renderer";
import { PDF_FONT_FAMILY } from "../pdf/shell";
import { ROW_HEIGHT } from "./layout";

/**
 * Styles shared by every Answer sheet section (Text Round and Music Round):
 * the dashed-cut-line cell frame, the heading line, and the team-name line.
 * Width differs per section (eighth-page vs quarter-page), so it is applied
 * by the caller alongside `cell`.
 */
export const sectionStyles = StyleSheet.create({
  cell: {
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
});
