import path from "node:path";

/**
 * Single source of truth for the label template structure. Every text box
 * name, media path, and geometry constant used by the writer/reader/logo
 * routes lives here so the template can be re-mapped without hunting for
 * magic strings across the codebase.
 */
export const LABEL_TEMPLATE = {
  samplePath: path.join("sample", "Lava Cake Label 6''x4''.docx"),
  textBoxes: {
    itemNumber: "Text Box 1",
    productName: "Text Box 2",
    lotAndBestBefore: "Text Box 3",
    storageInstruction: "Text Box 4",
    ingredients: "Text Box 5",
    humanReadableBarcode: "Text Box 7",
  },
  barcodeDrawing: "Picture 7",
  barcodeMediaPath: "word/media/image2.png",
  logoMediaPath: "word/media/image1.jpeg",
  geometry: {
    // Barcode drawing anchor: 3.4" x 0.81" high-clarity artwork slot.
    barcodeAnchor: { widthEmu: 3108960, heightEmu: 740664 },
    // Human-readable GS1 text sits just below the barcode artwork.
    humanReadableBarcodeOffsetEmu: 912114,
    // Ingredients box grows from compact to expanded when text is long.
    ingredientsBox: {
      widthEmu: 3211195,
      compactHeightEmu: 1276350,
      expandedHeightEmu: 1508760,
    },
  },
} as const;

export function labelTemplatePath(): string {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), LABEL_TEMPLATE.samplePath);
}
