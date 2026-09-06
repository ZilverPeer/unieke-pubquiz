import { StyleSheet } from "@react-pdf/renderer";
import { PDF_FONT_FAMILY } from "../pdf/shell";
import { ROW_HEIGHT } from "./layout";

/**
 * Styles shared by every Answer sheet section (Text Round and Music Round):
 * the dashed-cut-line cell frame, the header row (heading and team-name
 * field on one line), and the fonts they use. Width differs per section
 * (single grid cell vs full-width Music row), so it is applied by the
 * caller alongside `cell`.
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
  header: {
    flexDirection: "row",
    alignItems: "baseline",
    marginBottom: 3,
  },
  heading: {
    fontSize: 9,
    fontWeight: "bold",
    marginRight: 8,
  },
  teamName: {
    fontSize: 8,
  },
});
