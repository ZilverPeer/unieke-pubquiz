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

const COLUMNS = 2;
const CELL_HEIGHT = 108;

const styles = StyleSheet.create({
  logo: {
    width: 90,
    marginBottom: 12,
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
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  badge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#333333",
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "bold",
    textAlign: "center",
    lineHeight: 1.3,
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
 * Renders the Picture Round handout PDF: one A4 page with the 10 numbered
 * images of the Picture Round slot in a 2x5 grid, each with an answer line
 * underneath, so it doubles as the round's answer sheet.
 */
export async function renderPictureHandoutPdf(quiz: QuizContent): Promise<Buffer> {
  const round = quiz.rounds.find((r) => r.kind === "picture");
  if (!round) {
    throw new Error("QuizContent has no picture-kind Round");
  }

  const document = (
    <Document>
      <PdfPage>
        <Image src={logoBytes} style={styles.logo} />
        <Text style={styles.heading}>
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
                  <View style={styles.badgeRow}>
                    <Text style={styles.badge}>{index + 1}</Text>
                  </View>
                  <View style={styles.imageWrapper}>
                    <Image src={Buffer.from(item.image)} style={styles.image} />
                  </View>
                  <View style={styles.answerLine} />
                </View>
              </View>
            );
          })}
        </View>
      </PdfPage>
    </Document>
  );

  return renderToBuffer(document);
}
