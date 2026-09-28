import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { renderLabelPreviewPdf } from "@/domain/label-preview-pdf";

function countEmbeddedImages(pdf: PDFDocument): number {
  return pdf.context
    .enumerateIndirectObjects()
    .filter(
      ([, obj]) =>
        obj instanceof PDFRawStream && obj.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"),
    )
    .length;
}

const input = {
  productName: "Lava Cake 3 Inch",
  itemNumber: "GP2118",
  gtin: "10627146285749",
  lotCode: "72722",
  bestBefore: "2025-09-23",
  ingredients: "Eggs, sugar, wheat flour, margarine, dark chocolate.",
  storageInstruction: "KEEP FROZEN",
};

describe("label PDF preview", () => {
  it("renders a 4x6 PDF page for a complete label", async () => {
    const bytes = await renderLabelPreviewPdf(input);

    expect(Buffer.from(bytes.slice(0, 5)).toString("utf8")).toBe("%PDF-");

    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    const page = pdf.getPage(0);
    expect(Math.round(page.getWidth())).toBe(288);
    expect(Math.round(page.getHeight())).toBe(432);
    // Template logo + generated barcode PNG (plus its alpha SMask).
    expect(countEmbeddedImages(pdf)).toBeGreaterThanOrEqual(2);
  });

  it("still renders with incomplete data and long ingredients", async () => {
    const bytes = await renderLabelPreviewPdf({
      ...input,
      gtin: "",
      lotCode: "",
      bestBefore: "",
      ingredients: `Eggs, sugar, wheat flour, ${"x".repeat(600)}`,
    });

    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(countEmbeddedImages(pdf)).toBeGreaterThanOrEqual(1);
  });
});
