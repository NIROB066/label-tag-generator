/**
 * Pure label geometry constants (EMU) shared by the DOCX writer and the
 * PDF preview renderer. Kept free of Node imports so any environment can
 * consume the same numbers the generated document uses.
 */
export const LABEL_GEOMETRY = {
  // Barcode drawing anchor ("Picture 7"): 3.29" x 0.78" slot whose PNG
  // includes its own white padding, so it visually clears the box above it.
  barcodeAnchor: { widthEmu: 3108960, heightEmu: 740410 },
  // Human-readable GS1 text box ("Text Box 7") sits just below the artwork.
  humanReadableBarcodeOffsetEmu: 1136416,
  // Ingredients box grows from compact to expanded when text is long.
  ingredientsBox: {
    widthEmu: 3211195,
    compactHeightEmu: 1276350,
    expandedHeightEmu: 2013284,
  },
} as const;
