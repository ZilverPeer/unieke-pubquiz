import path from "node:path";
import { fileURLToPath } from "node:url";
import { Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";

const fontsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fonts");

/** Registered font family name to use in renderer StyleSheets. */
export const PDF_FONT_FAMILY = "Open Sans";

let registered = false;

/** Registers the brand font family with @react-pdf/renderer. Safe to call more than once. */
export function registerPdfFonts(): void {
  if (registered) return;
  Font.register({
    family: PDF_FONT_FAMILY,
    fonts: [
      { src: path.join(fontsDir, "OpenSans-Regular.ttf"), fontWeight: "normal" },
      { src: path.join(fontsDir, "OpenSans-Bold.ttf"), fontWeight: "bold" },
    ],
  });
  registered = true;
}

registerPdfFonts();

const styles = StyleSheet.create({
  page: {
    fontFamily: PDF_FONT_FAMILY,
    fontSize: 11,
    paddingTop: 60,
    paddingBottom: 48,
    paddingHorizontal: 36,
  },
  header: {
    position: "absolute",
    top: 20,
    left: 36,
    right: 36,
    fontSize: 10,
    fontWeight: "bold",
    textAlign: "center",
    color: "#333333",
  },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 36,
    right: 36,
    fontSize: 8,
    textAlign: "center",
    color: "#666666",
  },
  content: {
    flexGrow: 1,
  },
});

export interface PdfPageProps {
  children: ReactNode;
}

/**
 * Branded A4 page frame: a minimal header ("Unieke Pubquiz") and footer,
 * shared by every PDF Deliverable. Renderer tickets place content in `children`.
 */
export function PdfPage({ children }: PdfPageProps) {
  return (
    <Page size="A4" style={styles.page}>
      <Text style={styles.header} fixed>
        Unieke Pubquiz
      </Text>
      <View style={styles.content}>{children}</View>
      <Text
        style={styles.footer}
        fixed
        render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
      />
    </Page>
  );
}
