import { Document, renderToBuffer, Text } from "@react-pdf/renderer";
import { describe, expect, test } from "vitest";
import { PdfPage } from "./shell";

describe("PdfPage", () => {
  test("renders one branded A4 page to a PDF buffer", async () => {
    const buffer = await renderToBuffer(
      <Document>
        <PdfPage>
          <Text>Hello quiz</Text>
        </PdfPage>
      </Document>,
    );

    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");

    const pageCount = buffer.toString("latin1").match(/\/Type\s*\/Page[^s]/g)
      ?.length;
    expect(pageCount).toBe(1);
  });
});
