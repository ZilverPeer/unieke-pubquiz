import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { QuizContent } from "@/domain";
import { message } from "@/domain";
import { Document, Image, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { PdfPage } from "./pdf/shell";

const logoPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "public",
  "images",
  "pubquiz-logo-black.png",
);

// Read into a Buffer up front rather than passing the path string to <Image src>:
// @react-pdf/image resolves a string src through `new URL()`, which misparses a
// Windows absolute path (the "C:" drive letter is read as a URL scheme), silently
// failing the image load. A Buffer src skips that path-resolution step entirely.
const logoBytes = fs.readFileSync(logoPath);

// Landscape A4's content area (after PdfPage's padding) is roughly
// 770 x 487pt, of which the heading/instruction/team-name block above the
// grid takes up ~90-130pt (the heading can wrap to two lines for a long
// Category name), leaving ~360-395pt of grid height. For 11 cells (10
// images + the logo), a c-columns x r-rows grid wastes c*r - 11 slots, and
// its cells get width = pageWidth / c, height = gridHeight / r. Cell *area*
// is roughly conserved across choices of (c, r) with c*r fixed, so the
// deciding factor is matching the cell's aspect ratio to the grid area's
// aspect ratio (~770/380 ≈ 2) so a photo of any orientation fills as much of
// its cell as possible: 4 columns x 3 rows gives a cell aspect
// (770/4)/(380/3) ≈ 1.5, closer to that target than the other 12-slot
// options (6x2 ≈ 5.9, 3x4 ≈ 0.66), while wasting only a single slot.
// CELL_HEIGHT=130 (3 rows = 390pt) is the tallest that still leaves one page
// even when the heading wraps to two lines for a 60-character Category name.
const COLUMNS = 4;
const CELL_HEIGHT = 130;
const MAX_UNBROKEN_RUN = 14;

/**
 * @react-pdf/renderer's default hyphenation only inserts break points inside
 * words its heuristic recognises; a long run with no such points (a long
 * technical term, an all-caps abbreviation, ...) is laid out as one
 * unbreakable line that overflows the page's right edge instead of wrapping.
 * Falls back to forcing a break every MAX_UNBROKEN_RUN characters so any
 * Category name wraps within the page width.
 */
function wrapLongRuns(word: string, builtinHyphenate?: (word: string) => string[]): string[] {
  const parts = builtinHyphenate ? builtinHyphenate(word) : [word];
  if (parts.length > 1 || word.length <= MAX_UNBROKEN_RUN) return parts;

  const chunks: string[] = [];
  for (let i = 0; i < word.length; i += MAX_UNBROKEN_RUN) {
    chunks.push(word.slice(i, i + MAX_UNBROKEN_RUN));
  }
  return chunks;
}

const styles = StyleSheet.create({
  logoImage: {
    maxWidth: "100%",
    maxHeight: "100%",
    objectFit: "contain",
  },
  heading: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 4,
  },
  instruction: {
    fontSize: 10,
    marginBottom: 8,
  },
  teamName: {
    fontSize: 11,
    marginBottom: 12,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    width: `${100 / COLUMNS}%`,
    height: CELL_HEIGHT,
    paddingHorizontal: 6,
    paddingBottom: 6,
  },
  cellInner: {
    flex: 1,
    flexDirection: "column",
    border: "1pt solid #333333",
    padding: 6,
  },
  number: {
    fontSize: 11,
    fontWeight: "bold",
    marginBottom: 4,
  },
  imageWrapper: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  image: {
    maxWidth: "100%",
    maxHeight: "100%",
    objectFit: "contain",
  },
  answerLine: {
    borderBottomWidth: 1,
    borderBottomColor: "#333333",
    borderBottomStyle: "solid",
    height: 14,
    marginTop: 4,
  },
});

/**
 * Renders the Picture Round handout PDF: one landscape A4 page with the 10
 * numbered images of the Picture Round slot plus the brand logo in an 11-cell
 * 4x3 grid (see COLUMNS/CELL_HEIGHT above for why), each image cell with an
 * answer line underneath, so it doubles as the round's answer sheet.
 */
export async function renderPictureHandoutPdf(quiz: QuizContent): Promise<Buffer> {
  const round = quiz.rounds.find((r) => r.kind === "picture");
  if (!round) {
    throw new Error("QuizContent has no picture-kind Round");
  }

  const document = (
    <Document>
      <PdfPage orientation="landscape">
        <Text style={styles.heading} hyphenationCallback={wrapLongRuns}>
          {message(quiz.locale, "pictureRoundHeading")}: {round.categoryName}
        </Text>
        <Text style={styles.instruction}>
          {message(quiz.locale, "pictureHandoutInstruction")}
        </Text>
        <Text style={styles.teamName}>
          {message(quiz.locale, "teamNameLabel")}: ____________________
        </Text>
        <View style={styles.grid}>
          {round.items.map((item, index) => {
            if (item.kind !== "picture") {
              throw new Error(`Expected a picture-kind Item in this slot, got "${item.kind}"`);
            }
            return (
              <View key={item.id} style={styles.cell} wrap={false}>
                <View style={styles.cellInner}>
                  <Text style={styles.number}>{index + 1}</Text>
                  <View style={styles.imageWrapper}>
                    <Image src={Buffer.from(item.image)} style={styles.image} />
                  </View>
                  <View style={styles.answerLine} />
                </View>
              </View>
            );
          })}
          <View key="logo" style={styles.cell} wrap={false}>
            <View style={styles.cellInner}>
              <View style={styles.imageWrapper}>
                <Image src={logoBytes} style={styles.logoImage} />
              </View>
            </View>
          </View>
        </View>
      </PdfPage>
    </Document>
  );

  return renderToBuffer(document);
}
