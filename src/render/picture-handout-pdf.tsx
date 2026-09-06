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

// Landscape A4's content area (after PdfPage's padding of paddingTop 60 +
// paddingBottom 48, paddingHorizontal 36 each side) is 841.89 - 72 = 769.89pt
// wide by 595.28 - 108 = 487.28pt tall. For 11 cells (10 images + the logo),
// a c-columns x r-rows grid wastes c*r - 11 slots, and its cells get width =
// pageWidth / c, height = gridHeight / r. Cell *area* is roughly conserved
// across choices of (c, r) with c*r fixed, so the deciding factor is
// matching the cell's aspect ratio to the grid area's aspect ratio so a
// photo of any orientation fills as much of its cell as possible. With
// ~380pt of grid height (see below) that ratio is 770/380 ≈ 2; 4 columns x 3
// rows gives a cell aspect (770/4)/(380/3) ≈ 1.5, closer to that target than
// the other 12-slot options (6x2 ≈ 5.9, 3x4 ≈ 0.66), while wasting only a
// single slot.
//
// The header above the grid is a one-line heading (~23pt incl. margin) plus
// a shared instruction/team-name row (~21pt incl. margin) — but the heading
// can wrap to two lines for a long Category name, adding one more line
// (~19pt) in the worst case: ~63pt worst-case header vs ~44pt normal. Budget
// for the worst case: 487.28 - 63 ≈ 424pt of grid height / 3 rows ≈ 141pt
// per row. CELL_HEIGHT=135 stays comfortably inside that (measured empirically
// against a two-line-wrapping Category name; 140 already overflows to a
// second page), leaving a small margin for font-metric variance.
const COLUMNS = 4;
const CELL_HEIGHT = 135;
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
  // Instruction and the team-name blank share one row instead of two stacked
  // lines, winning back header height for the grid below.
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 8,
  },
  instruction: {
    fontSize: 10,
  },
  teamName: {
    fontSize: 11,
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
  // The logo cell is plain branding, not an answer cell, so it gets no
  // border frame.
  logoCellInner: {
    flex: 1,
    flexDirection: "column",
    padding: 6,
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
  // The number lives inline with the answer line ("1  __________") instead
  // of on its own line above the image, winning back cell height for the
  // image.
  answerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginTop: 4,
  },
  number: {
    fontSize: 11,
    fontWeight: "bold",
    marginRight: 6,
  },
  answerLine: {
    flexGrow: 1,
    borderBottomWidth: 1,
    borderBottomColor: "#333333",
    borderBottomStyle: "solid",
    height: 14,
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
        <View style={styles.metaRow}>
          <Text style={styles.instruction}>
            {message(quiz.locale, "pictureHandoutInstruction")}
          </Text>
          <Text style={styles.teamName}>
            {message(quiz.locale, "teamNameLabel")}: ____________________
          </Text>
        </View>
        <View style={styles.grid}>
          {round.items.map((item, index) => {
            if (item.kind !== "picture") {
              throw new Error(`Expected a picture-kind Item in this slot, got "${item.kind}"`);
            }
            return (
              <View key={item.id} style={styles.cell} wrap={false}>
                <View style={styles.cellInner}>
                  <View style={styles.imageWrapper}>
                    <Image src={Buffer.from(item.image)} style={styles.image} />
                  </View>
                  <View style={styles.answerRow}>
                    <Text style={styles.number}>{index + 1}</Text>
                    <View style={styles.answerLine} />
                  </View>
                </View>
              </View>
            );
          })}
          <View key="logo" style={styles.cell} wrap={false}>
            <View style={styles.logoCellInner}>
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
