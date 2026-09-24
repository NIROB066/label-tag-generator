/**
 * Pure typography rules for auto-fitting label text inside the fixed
 * template text boxes. Kept free of DOCX/XML concerns so the sizing
 * behaviour is unit-testable on its own.
 */

/** Average glyph width as a fraction of the font size, measured against the template serif face. */
const AVG_CHAR_WIDTH_FACTOR = 0.55;

/** Usable inner width of the product-name text box ("Text Box 2") in points (~3.2"). */
export const TITLE_BOX_WIDTH_PT = 232;

/** Template title size (half-points, i.e. 21pt) applied when it fits. */
export const TITLE_FONT_MAX_HALF_POINTS = 42;

/** Never shrink the title below 10pt; two lines at this size fit any realistic name. */
export const TITLE_FONT_MIN_HALF_POINTS = 20;

/** The title may wrap onto at most two lines before the font shrinks. */
export const TITLE_MAX_LINES = 2;

/** Template ingredient size (half-points, i.e. 10pt). */
export const INGREDIENTS_FONT_MAX_HALF_POINTS = 20;

/** Floor for ingredient text so it stays legally readable on print. */
export const INGREDIENTS_FONT_MIN_HALF_POINTS = 12;

/** Ingredient lengths (in characters) that trigger each shrink step. */
export const INGREDIENTS_SHRINK_THRESHOLDS = [120, 280, 400, 520] as const;

/** Ingredients longer than this expand the text box to its taller preset. */
export const INGREDIENTS_LONG_THRESHOLD = INGREDIENTS_SHRINK_THRESHOLDS[0];

/**
 * Greedy word-wrap line count for `text` rendered at `fontHalfPoints`
 * inside a box `boxWidthPt` points wide.
 */
export function estimateWrappedLines(
  text: string,
  fontHalfPoints: number,
  boxWidthPt: number,
): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return 0;
  }

  const charsPerLine = Math.max(
    1,
    Math.floor(boxWidthPt / ((fontHalfPoints / 2) * AVG_CHAR_WIDTH_FACTOR)),
  );

  let lines = 0;
  let currentLineLength = 0;

  for (const word of words) {
    if (currentLineLength === 0) {
      lines += Math.max(1, Math.ceil(word.length / charsPerLine));
      currentLineLength = word.length % charsPerLine || charsPerLine;
      continue;
    }

    if (currentLineLength + 1 + word.length <= charsPerLine) {
      currentLineLength += 1 + word.length;
    } else {
      lines += Math.max(1, Math.ceil(word.length / charsPerLine));
      currentLineLength = word.length % charsPerLine || charsPerLine;
    }
  }

  return Math.max(1, lines);
}

/**
 * Picks the largest title font size (half-points) that keeps the product
 * name within TITLE_MAX_LINES wrapped lines, stepping down in 2
 * half-point increments from the template default.
 */
export function pickTitleFontSize(productName: string): number {
  let size = TITLE_FONT_MAX_HALF_POINTS;

  while (
    size > TITLE_FONT_MIN_HALF_POINTS &&
    estimateWrappedLines(productName, size, TITLE_BOX_WIDTH_PT) > TITLE_MAX_LINES
  ) {
    size -= 2;
  }

  return size;
}

/**
 * Picks the ingredient font size (half-points) for an ingredient string,
 * shrinking progressively as the declaration grows past each threshold.
 */
export function pickIngredientFontSize(ingredients: string): number {
  let size = INGREDIENTS_FONT_MAX_HALF_POINTS;

  for (const threshold of INGREDIENTS_SHRINK_THRESHOLDS) {
    if (ingredients.length > threshold) {
      size = Math.max(INGREDIENTS_FONT_MIN_HALF_POINTS, size - 2);
    }
  }

  return size;
}
