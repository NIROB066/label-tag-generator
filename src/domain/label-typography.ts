/**
 * Pure typography rules for auto-fitting label text inside the fixed
 * template text boxes. Kept free of DOCX/XML concerns so the sizing
 * behaviour is unit-testable on its own.
 */

/** Average glyph width as a fraction of the font size, measured against the template serif face. */
const AVG_CHAR_WIDTH_FACTOR = 0.55;

/** Usable inner width of the product-name text box ("Text Box 2"): 1.95" box minus default 0.1" side insets. */
export const TITLE_BOX_WIDTH_PT = 126;

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

/** Ingredient lists longer than this expand the text box to its taller preset. */
export const INGREDIENTS_LONG_THRESHOLD = 120;

/** Usable inner width of the ingredients text box ("Text Box 5"): 3.51" box minus default 0.1" side insets. */
export const INGREDIENTS_BOX_WIDTH_PT = 238;

/** Compact and expanded ingredients box heights (1.396" / 2.202") in points. */
export const INGREDIENTS_BOX_COMPACT_HEIGHT_PT = 100.5;
export const INGREDIENTS_BOX_EXPANDED_HEIGHT_PT = 158.5;

/** First baseline sits 13.5pt below the box top; wrapped value lines drop 9.2pt then pitch at 1.267 × size. */
const INGREDIENTS_FIRST_BASELINE_PT = 13.5;
const INGREDIENTS_FIRST_VALUE_DROP_PT = 9.2;
const INGREDIENTS_LINE_PITCH_FACTOR = 1.267;

/**
 * Wrapped value lines that fit the ingredients box at `fontHalfPoints`:
 * baseline of the last line must clear the box bottom including descent.
 */
export function ingredientsLineCapacity(boxHeightPt: number, fontHalfPoints: number): number {
  const size = fontHalfPoints / 2;
  const usable =
    boxHeightPt - INGREDIENTS_FIRST_BASELINE_PT - INGREDIENTS_FIRST_VALUE_DROP_PT - 0.25 * size;
  return Math.max(1, 1 + Math.floor(usable / (size * INGREDIENTS_LINE_PITCH_FACTOR)));
}

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
 * Ensures ingredient declarations read consistently: every comma gets a
 * single space before the next word; a closing parenthesis directly
 * followed by another word gains a single space — but only when the
 * parenthesis closes a word (the character before it is a letter) and
 * what follows is not a comma or another closing parenthesis; and an
 * opening parenthesis preceded directly by a letter gains a single
 * space before it.
 */
export function normalizeIngredientsSpacing(ingredients: string): string {
  return ingredients
    .replace(/,(?=\S)/g, ", ")
    .replace(/(?<=[A-Za-z])\)(?=[^,\s)])/g, ") ")
    .replace(/(?<=[A-Za-z])\(/g, " (");
}

/**
 * Picks the largest ingredient font size (half-points) whose wrapped line
 * count fits the box the writer will choose for the declaration — compact
 * for short lists, expanded beyond INGREDIENTS_LONG_THRESHOLD. Sizing by
 * actual fit keeps the text as large as the available space allows instead
 * of shrinking purely by character count.
 */
export function pickIngredientFontSize(ingredients: string): number {
  const boxHeightPt =
    ingredients.length > INGREDIENTS_LONG_THRESHOLD
      ? INGREDIENTS_BOX_EXPANDED_HEIGHT_PT
      : INGREDIENTS_BOX_COMPACT_HEIGHT_PT;

  let size = INGREDIENTS_FONT_MAX_HALF_POINTS;
  while (
    size > INGREDIENTS_FONT_MIN_HALF_POINTS &&
    estimateWrappedLines(ingredients, size, INGREDIENTS_BOX_WIDTH_PT) >
      ingredientsLineCapacity(boxHeightPt, size)
  ) {
    size -= 2;
  }
  return size;
}
