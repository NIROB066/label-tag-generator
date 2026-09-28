import path from "node:path";

import { LABEL_GEOMETRY } from "@/domain/label-geometry";

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
  geometry: LABEL_GEOMETRY,
} as const;

export function labelTemplatePath(): string {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), LABEL_TEMPLATE.samplePath);
}
