import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";

import { generateGs1BarcodePng } from "@/domain/barcode";
import { buildGs1Payload } from "@/domain/gs1";
import { LABEL_TEMPLATE, labelTemplatePath } from "@/domain/label-template";
import {
  INGREDIENTS_LONG_THRESHOLD,
  normalizeIngredientsSpacing,
  pickIngredientFontSize,
  pickTitleFontSize,
} from "@/domain/label-typography";
import { LabelInput } from "@/domain/label-schema";

/**
 * Renders the Create-mode preview as a real 4"x6" PDF using the exact same
 * data, barcode generator, and auto-fit typography rules as the generated
 * DOCX. Layout constants (boxes, insets, baselines) are measured from the
 * Word-rendered reference label, so the PDF mirrors the printed document
 * without depending on Microsoft Word.
 */

const PAGE_WIDTH = 288;
const PAGE_HEIGHT = 432;
const INK = rgb(0.07, 0.09, 0.1);
const PAPER = rgb(1, 1, 1);

/** Label element geometry in points; y is measured from the page top. */
const LAYOUT = {
  logo: { x: 0, yTop: 31.6, w: 172.8, h: 54.3 },
  title: { x: 151.6, yTop: 37.9, w: 140.4, h: 62.64, textX: 159.1, wrapWidth: 126 },
  item: { x: 172.1, yTop: 9.2, w: 95, h: 21.9, textX: 179.5 },
  lot: { x: 16.5, yTop: 100.4, w: 154.5, h: 63.9, textX: 24.2, firstBaseline: 22.4, linePitch: 21.8 },
  storage: { x: 187.7, yTop: 100.7, w: 81.2, h: 50.1, firstBaselineOffset: 18.9, linePitchFactor: 1.224 },
  ingredients: {
    x: 17.1,
    yTop: 166.7,
    w: 252.9,
    compactH: 100.5,
    expandedH: 158.5,
    textX: 24.7,
    labelBaselineOffset: 13.5,
    firstValueDrop: 9.2,
    valuePitchFactor: 1.267,
    wrapWidth: 238,
  },
  barcode: { x: 23.6, yTop: 322.1, w: 244.8, h: 58.3 },
  footer: {
    x: 38.4,
    w: 215.4,
    yTop: 378.4,
    centerX: 146.1,
    numberBaseline: 389.5,
    companyBaseline: 411.6,
    addressBaseline: 425,
  },
} as const;

const FONT_SIZE = {
  item: 11,
  lot: 11,
  storage: 16,
  ingredientsLabel: 10,
  barcodeNumber: 8,
  company: 11,
} as const;

const DEFAULT_ADDRESS = "Gastronomique pastry INC, 7621 vantage way, Delta, BC V4G 1A6";

export type LabelPreviewInput = LabelInput & { address?: string };

type Fonts = { regular: PDFFont; bold: PDFFont; serifBold: PDFFont };
type Segment = { text: string; bold: boolean; size: number; serif?: boolean };
type FlowToken = { text: string; bold: boolean; size: number; glued: boolean };

export async function renderLabelPreviewPdf(input: LabelPreviewInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Label preview");
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    serifBold: await pdf.embedFont(StandardFonts.TimesRomanBold),
  };

  const payload = (() => {
    try {
      return buildGs1Payload(input);
    } catch {
      return null;
    }
  })();

  await drawLogo(pdf, page);
  drawTitle(page, fonts, input.productName);
  drawItemBadge(page, fonts, input.itemNumber);
  drawLotBox(page, fonts, input.lotCode, input.bestBefore);
  drawStorageBox(page, fonts, input.storageInstruction);
  drawIngredients(page, fonts, input.ingredients);

  if (payload) {
    const png = await pdf.embedPng(await generateGs1BarcodePng(payload));
    page.drawImage(png, boxToRect(LAYOUT.barcode));
  } else {
    drawBarcodePlaceholder(page, fonts, payload === null);
  }

  drawFooter(page, fonts, payload?.humanReadable, input.address);
  return pdf.save();
}

type Rect = { x: number; y: number; width: number; height: number };

function boxToRect(box: { x: number; yTop: number; w: number; h: number }): Rect {
  return { x: box.x, y: PAGE_HEIGHT - box.yTop - box.h, width: box.w, height: box.h };
}

async function drawLogo(pdf: PDFDocument, page: PDFPage) {
  try {
    const template = await readFile(labelTemplatePath());
    const zip = await JSZip.loadAsync(template);
    const logo = zip.file(LABEL_TEMPLATE.logoMediaPath);
    if (!logo) return;
    const jpeg = await pdf.embedJpg(await logo.async("uint8array"));
    page.drawImage(jpeg, boxToRect(LAYOUT.logo));
  } catch {
    // The logo is decorative; the preview still renders without it.
  }
}

function drawTitle(page: PDFPage, fonts: Fonts, productName: string) {
  const text = sanitize(productName.trim() || "Your product name");
  // Wrap at word boundaries and shrink until the name fits two lines,
  // mirroring the writer's two-line auto-fit rule.
  let size: number = pickTitleFontSize(productName) / 2;
  for (const word of text.split(" ").filter(Boolean)) {
    size = Math.min(size, fitSize(fonts.regular, word, size, LAYOUT.title.wrapWidth));
  }
  let lines = wrapWholeWords(fonts.regular, size, text, LAYOUT.title.wrapWidth);
  while (lines.length > 2 && size > 5) {
    size -= 0.5;
    lines = wrapWholeWords(fonts.regular, size, text, LAYOUT.title.wrapWidth);
  }
  const pitch = size * 1.238;
  const firstBaseline = LAYOUT.title.yTop + 3.6 + 0.903 * size + 0.7;
  lines.slice(0, 2).forEach((line, index) => {
    drawSegments(
      page,
      fonts,
      [{ text: line, bold: false, size }],
      LAYOUT.title.textX,
      firstBaseline + index * pitch,
    );
  });
}

function drawItemBadge(page: PDFPage, fonts: Fonts, itemNumber: string) {
  const { x, yTop, w, h } = LAYOUT.item;
  page.drawRectangle({ ...boxToRect({ x, yTop, w, h }), color: INK });
  const text = sanitize(`ITEM #${itemNumber.trim() || "—"}`);
  const size = fitSize(fonts.bold, text, FONT_SIZE.item, w - 14.8);
  const baseline = yTop + (h + 0.7 * size) / 2;
  drawSegments(page, fonts, [{ text, bold: true, size }], LAYOUT.item.textX, baseline, PAPER);
}

function drawLotBox(page: PDFPage, fonts: Fonts, lotCode: string, bestBefore: string) {
  const { x, yTop, w, h } = LAYOUT.lot;
  page.drawRectangle({ ...boxToRect({ x, yTop, w, h }), borderColor: INK, borderWidth: 1 });
  const lot = sanitize(`LOT CODE: ${lotCode.trim() || "—"}`);
  const date = sanitize(`BEST BEFORE: ${(bestBefore.trim() || "—").replaceAll("-", "/")}`);
  const size = Math.min(
    fitSize(fonts.regular, lot, FONT_SIZE.lot, w - 16),
    fitSize(fonts.regular, date, FONT_SIZE.lot, w - 16),
  );
  drawSegments(page, fonts, [{ text: lot, bold: false, size }], LAYOUT.lot.textX, yTop + LAYOUT.lot.firstBaseline);
  drawSegments(
    page,
    fonts,
    [{ text: date, bold: false, size }],
    LAYOUT.lot.textX,
    yTop + LAYOUT.lot.firstBaseline + LAYOUT.lot.linePitch,
  );
}

function drawStorageBox(page: PDFPage, fonts: Fonts, storageInstruction: string) {
  const { x, yTop, w, h } = LAYOUT.storage;
  page.drawRectangle({ ...boxToRect({ x, yTop, w, h }), borderColor: INK, borderWidth: 1 });
  const text = sanitize(storageInstruction.trim() || "STORAGE");
  // Storage lines only wrap at word boundaries like the template does, so
  // the font shrinks until every whole word fits within two lines.
  let size: number = FONT_SIZE.storage;
  for (const word of text.split(" ").filter(Boolean)) {
    size = Math.min(size, fitSize(fonts.bold, word, size, w - 8));
  }
  let lines = wrapWholeWords(fonts.bold, size, text, w - 8);
  while (lines.length > 2 && size > 6) {
    size -= 0.5;
    lines = wrapWholeWords(fonts.bold, size, text, w - 8);
  }
  const pitch = size * LAYOUT.storage.linePitchFactor;
  const firstBaseline = yTop + LAYOUT.storage.firstBaselineOffset;
  lines.slice(0, 2).forEach((line, index) => {
    const width = fonts.bold.widthOfTextAtSize(line, size);
    drawSegments(
      page,
      fonts,
      [{ text: line, bold: true, size }],
      x + (w - width) / 2,
      firstBaseline + index * pitch,
    );
  });
}

function drawIngredients(page: PDFPage, fonts: Fonts, rawIngredients: string) {
  const ingredients = normalizeIngredientsSpacing(rawIngredients);
  const config = LAYOUT.ingredients;
  const boxHeight =
    ingredients.length > INGREDIENTS_LONG_THRESHOLD ? config.expandedH : config.compactH;
  page.drawRectangle({
    ...boxToRect({ x: config.x, yTop: config.yTop, w: config.w, h: boxHeight }),
    borderColor: INK,
    borderWidth: 1,
  });

  const valueSize = pickIngredientFontSize(ingredients) / 2;
  const value = sanitize(
    ingredients.trim() ? ingredients : "Ingredient list appears here as you type",
  );
  // The bold label and the value share the first line with no separator —
  // exactly how the writer builds the document's first paragraph. The
  // first value word is glued to the label; later words get one space.
  const words = value.split(" ").filter(Boolean);
  const tokens: FlowToken[] = [
    { text: "Ingredients:", bold: true, size: FONT_SIZE.ingredientsLabel, glued: true },
    ...words.map((word, index) => ({
      text: word,
      bold: false,
      size: valueSize,
      glued: index === 0,
    })),
  ];
  const lines = layoutFlow(tokens, fonts, config.wrapWidth);

  const firstBaseline = config.yTop + config.labelBaselineOffset;
  const valuePitch = valueSize * config.valuePitchFactor;
  const maxBaseline = config.yTop + boxHeight - 4;
  lines.forEach((line, index) => {
    const baseline =
      index === 0
        ? firstBaseline
        : firstBaseline + config.firstValueDrop + (index - 1) * valuePitch;
    if (baseline <= maxBaseline) {
      drawSegments(page, fonts, line, config.textX, baseline);
    }
  });
}

function drawBarcodePlaceholder(page: PDFPage, fonts: Fonts, fieldsMissing: boolean) {
  const { x, yTop, w, h } = LAYOUT.barcode;
  page.drawRectangle({ ...boxToRect({ x, yTop, w, h }), color: rgb(0.94, 0.93, 0.9) });
  const text = fieldsMissing ? "Barcode appears once GTIN, date, and lot are filled in" : "Barcode preview";
  const size = fitSize(fonts.regular, text, 9, w - 20);
  const width = fonts.regular.widthOfTextAtSize(text, size);
  drawSegments(
    page,
    fonts,
    [{ text, bold: false, size }],
    x + (w - width) / 2,
    yTop + h / 2 + 3,
    rgb(0.43, 0.47, 0.45),
  );
}

function drawFooter(
  page: PDFPage,
  fonts: Fonts,
  barcodeNumber: string | undefined,
  address?: string,
) {
  const { x, yTop, w, centerX } = LAYOUT.footer;
  // The template's footer text box has a white fill that sits above the
  // barcode's bottom padding; reproduce that z-order so the barcode's white
  // margin never shows through.
  page.drawRectangle({ ...boxToRect({ x, yTop, w, h: PAGE_HEIGHT - yTop }), color: PAPER });

  const numberText = barcodeNumber
    ? sanitize(barcodeNumber)
    : "The barcode number appears once GTIN, date, and lot are filled in";
  const numberSize = fitSize(fonts.regular, numberText, FONT_SIZE.barcodeNumber, w - 10);
  drawCenteredSegments(
    page,
    fonts,
    [{ text: numberText, bold: false, size: numberSize }],
    centerX,
    LAYOUT.footer.numberBaseline,
  );

  const addressText = address?.trim() || DEFAULT_ADDRESS;
  const commaIndex = addressText.indexOf(",");
  const company = sanitize(commaIndex === -1 ? addressText : addressText.slice(0, commaIndex).trim());
  const addressLine = sanitize(commaIndex === -1 ? "" : addressText.slice(commaIndex + 1).trim());

  const companySize = fitSize(fonts.serifBold, company, FONT_SIZE.company, w - 10);
  drawCenteredSegments(
    page,
    fonts,
    [{ text: company, bold: false, size: companySize, serif: true }],
    centerX,
    LAYOUT.footer.companyBaseline,
  );
  if (addressLine) {
    const addressSize = fitSize(fonts.serifBold, addressLine, FONT_SIZE.company, w - 10);
    drawCenteredSegments(
      page,
      fonts,
      [{ text: addressLine, bold: false, size: addressSize, serif: true }],
      centerX,
      LAYOUT.footer.addressBaseline,
    );
  }
}

/** Word-boundary-only wrap; never breaks a word mid-line. */
function wrapWholeWords(font: PDFFont, size: number, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ").filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Greedy line layout over styled tokens. Words get a single separating
 * space; `glued` tokens (like the bold "Ingredients:" label) never receive
 * a separating space after the previous token. A word that no longer fits
 * the current line wraps whole to the next line — matching Word's
 * whole-word wrapping — and only a word wider than an entire line is
 * broken at the character level.
 */
function layoutFlow(tokens: FlowToken[], fonts: Fonts, maxWidth: number): Segment[][] {
  const lines: Segment[][] = [];
  let current: Segment[] = [];
  let used = 0;

  const pushLine = () => {
    lines.push(current);
    current = [];
    used = 0;
  };

  for (const token of tokens) {
    const font = tokenFont(fonts, token.bold);
    const prefix = current.length > 0 && !token.glued ? " " : "";
    const candidate = prefix + token.text;
    if (used + font.widthOfTextAtSize(candidate, token.size) <= maxWidth) {
      current.push({ text: candidate, bold: token.bold, size: token.size });
      used += font.widthOfTextAtSize(candidate, token.size);
      continue;
    }

    const tokenWidth = font.widthOfTextAtSize(token.text, token.size);
    if (tokenWidth <= maxWidth) {
      // The word fits a line of its own: move it whole, never a prefix.
      if (current.length > 0) pushLine();
      current.push({ text: token.text, bold: token.bold, size: token.size });
      used += tokenWidth;
      continue;
    }

    // Wider than an entire line: fall back to character-level breaking.
    let remaining = token.text;
    if (current.length > 0) pushLine();
    while (remaining.length > 0) {
      const piece = fitPrefix(font, token.size, remaining, maxWidth - used);
      if (piece === "") {
        if (current.length > 0) {
          pushLine();
          continue;
        }
        // Empty line but no room: force one character to guarantee progress.
        current.push({ text: remaining[0], bold: token.bold, size: token.size });
        used += font.widthOfTextAtSize(remaining[0], token.size);
        remaining = remaining.slice(1);
        continue;
      }
      current.push({ text: piece, bold: token.bold, size: token.size });
      used += font.widthOfTextAtSize(piece, token.size);
      remaining = remaining.slice(piece.length);
      if (remaining.length > 0) {
        pushLine();
      }
    }
  }

  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

function fitPrefix(font: PDFFont, size: number, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  for (let end = text.length - 1; end >= 1; end -= 1) {
    const piece = text.slice(0, end);
    if (font.widthOfTextAtSize(piece, size) <= maxWidth) {
      return piece;
    }
  }
  return "";
}

function fontFor(fonts: Fonts, segment: Segment): PDFFont {
  if (segment.serif) return fonts.serifBold;
  return segment.bold ? fonts.bold : fonts.regular;
}

function tokenFont(fonts: Fonts, bold: boolean): PDFFont {
  return bold ? fonts.bold : fonts.regular;
}

function segmentsWidth(fonts: Fonts, line: Segment[]): number {
  return line.reduce(
    (total, segment) => total + fontFor(fonts, segment).widthOfTextAtSize(segment.text, segment.size),
    0,
  );
}

function drawSegments(
  page: PDFPage,
  fonts: Fonts,
  line: Segment[],
  x: number,
  baselineFromTop: number,
  color = INK,
) {
  let cursor = x;
  for (const segment of line) {
    const font = fontFor(fonts, segment);
    page.drawText(segment.text, {
      x: cursor,
      y: PAGE_HEIGHT - baselineFromTop,
      size: segment.size,
      font,
      color,
    });
    cursor += font.widthOfTextAtSize(segment.text, segment.size);
  }
}

function drawCenteredSegments(
  page: PDFPage,
  fonts: Fonts,
  line: Segment[],
  centerX: number,
  baselineFromTop: number,
) {
  drawSegments(page, fonts, line, centerX - segmentsWidth(fonts, line) / 2, baselineFromTop);
}

function fitSize(font: PDFFont, text: string, size: number, maxWidth: number): number {
  const width = font.widthOfTextAtSize(text, size);
  if (width <= maxWidth || width === 0) {
    return size;
  }
  return Math.max(4, (size * maxWidth) / width);
}

/**
 * pdf-lib standard fonts use WinAnsi encoding; map common typography
 * characters and replace anything else outside it so rendering cannot fail.
 */
function sanitize(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u2022/g, "*")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x20-\x7E\u00A1-\u00FF]/g, "?");
}
