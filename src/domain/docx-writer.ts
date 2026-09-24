import { buildGs1Payload } from "@/domain/gs1";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { LabelInput } from "@/domain/label-schema";
import {
  LABEL_TEMPLATE,
  labelTemplatePath,
} from "@/domain/label-template";
import {
  INGREDIENTS_FONT_MAX_HALF_POINTS,
  INGREDIENTS_LONG_THRESHOLD,
  pickIngredientFontSize,
  pickTitleFontSize,
} from "@/domain/label-typography";

/**
 * Mutates the supplied sample package instead of rebuilding it. This keeps
 * Word's floating anchors, text-box geometry, theme, fonts, and artwork intact.
 */
export async function generateLabelDocx(input: LabelInput, barcodePng: Buffer): Promise<Buffer> {
  const template = await readFile(labelTemplatePath());
  return generateLabelDocxFromTemplate(template, input, barcodePng);
}

export async function generateLabelDocxFromTemplate(
  template: Uint8Array,
  input: LabelInput,
  barcodePng: Buffer,
): Promise<Buffer> {
  const payload = buildGs1Payload(input);
  const { textBoxes, barcodeDrawing, barcodeMediaPath, geometry } = LABEL_TEMPLATE;
  const zip = await JSZip.loadAsync(template, { checkCRC32: true });
  const documentEntry = zip.file("word/document.xml");
  if (!documentEntry) {
    throw new Error("Template is missing word/document.xml.");
  }

  let documentXml = await documentEntry.async("text");
  documentXml = replaceTextBox(documentXml, textBoxes.itemNumber, `ITEM #${input.itemNumber}`);
  documentXml = replaceTextBox(documentXml, textBoxes.productName, input.productName);
  documentXml = updateTextBox(documentXml, textBoxes.lotAndBestBefore, (content) =>
    updateLotAndDateRuns(content, input.lotCode, input.bestBefore),
  );
  documentXml = replaceTextBox(documentXml, textBoxes.storageInstruction, input.storageInstruction);
  documentXml = updateTextBox(documentXml, textBoxes.ingredients, (content) =>
    updateIngredientsRuns(content, input.ingredients),
  );
  documentXml = updateTextBox(documentXml, textBoxes.productName, (content) =>
    applyFontSize(content, pickTitleFontSize(input.productName)),
  );
  documentXml = updateTextBox(documentXml, textBoxes.ingredients, (content) =>
    updateIngredientFontSize(content, input.ingredients),
  );
  documentXml = updateAnchorGeometry(
    documentXml,
    barcodeDrawing,
    geometry.barcodeAnchor.widthEmu,
    geometry.barcodeAnchor.heightEmu,
  );
  documentXml = updateVerticalOffset(
    documentXml,
    textBoxes.humanReadableBarcode,
    geometry.humanReadableBarcodeOffsetEmu,
  );
  documentXml = updateAnchorGeometry(
    documentXml,
    textBoxes.ingredients,
    geometry.ingredientsBox.widthEmu,
    input.ingredients.length > INGREDIENTS_LONG_THRESHOLD
      ? geometry.ingredientsBox.expandedHeightEmu
      : geometry.ingredientsBox.compactHeightEmu,
  );
  documentXml = documentXml.replace(
    /\(01\)\d{14}\(15\)\d{6}\(10\)[^<]+/g,
    escapeXml(payload.humanReadable),
  );

  zip.file("word/document.xml", documentXml);
  zip.file(barcodeMediaPath, barcodePng);
  return zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
}

/**
 * Matches the template's own Arial space run (as used after "LOT CODE:")
 * so the date renders as "BEST BEFORE: YYYY/MM/DD" instead of being glued
 * to the label.
 */
const ARIAL_SPACE_RUN =
  '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r>';

function ensureSpaceAfterBestBeforeLabel(para2: string): string {
  const labelEnd = para2.indexOf(">BEST BEFORE:</w:t>");
  if (labelEnd < 0) {
    return para2;
  }

  const runEnd = para2.indexOf("</w:r>", labelEnd) + "</w:r>".length;
  const nextText = para2
    .slice(runEnd)
    .match(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/);

  if (nextText && nextText[1] === " ") {
    return para2;
  }

  return para2.slice(0, runEnd) + ARIAL_SPACE_RUN + para2.slice(runEnd);
}

function updateLotAndDateRuns(content: string, lotCode: string, bestBefore: string): string {
  const date = bestBefore.replaceAll("-", "/"); // YYYY/MM/DD

  // The text box content has two paragraphs:
  //   Para 1: LOT CODE: <digit-run>   (runs: "LOT ", "CODE", ":", " ", "26815")
  //   Para 2: BEST BEFORE: <date-runs> (runs: "BEST BEFORE:", "202", "7", "/", "02", "/", "15")
  // "LOT CODE:" is split across runs, so indexOf("LOT CODE:") = -1 — we must split by <w:p>.

  const para1End = content.indexOf("</w:p>");
  const para2End = content.indexOf("</w:p>", para1End + 1);

  if (para1End < 0 || para2End < 0) {
    // Unexpected structure — fall back to no-op
    return content;
  }

  // ── Para 1 (LOT CODE): replace the first pure-digit run ─────────────────
  let para1 = content.slice(0, para1End);
  {
    let replaced = false;
    para1 = para1.replace(TEXT_TAG, (tag) => {
      if (replaced) return tag;
      const value = textValue(tag);
      if (/^\d+$/.test(value)) {
        replaced = true;
        return replaceTextTag(tag, escapeXml(lotCode));
      }
      return tag;
    });
  }

  // ── Para 2 (BEST BEFORE): replace digit/slash runs positionally ──────────
  // The year may be split across multiple runs (e.g. "202" + "7"), so we use
  // a positional index across all digit/slash runs within this paragraph only.
  const dateValues = [date.slice(0, 4), "", "/", date.slice(5, 7), "/", date.slice(8, 10)];
  let dateIndex = 0;
  let para2 = content.slice(para1End, para2End).replace(TEXT_TAG, (tag) => {
    const value = textValue(tag);
    if (!/^\d{1,4}$|^\/$/.test(value)) return tag;
    const replacement = dateValues[dateIndex++] ?? "";
    return replaceTextTag(tag, replacement);
  });
  para2 = ensureSpaceAfterBestBeforeLabel(para2);

  return para1 + para2 + content.slice(para2End);
}

function updateIngredientsRuns(content: string, ingredients: string): string {
  let valueRun = false;
  let valueWritten = false;
  return content.replace(TEXT_TAG, (tag) => {
    const value = textValue(tag);
    if (value === "Ingredients:") {
      valueRun = true;
      return tag;
    }
    if (!valueRun || value === " ") {
      return tag;
    }
    if (!valueWritten) {
      valueWritten = true;
      return replaceTextTag(tag, ingredients);
    }
    return replaceTextTag(tag, "");
  });
}

function applyFontSize(content: string, fontSize: number): string {
  return content
    .replace(/<w:sz w:val="\d+"\/>/g, `<w:sz w:val="${fontSize}"/>`)
    .replace(/<w:szCs w:val="\d+"\/>/g, `<w:szCs w:val="${fontSize}"/>`);
}

function updateIngredientFontSize(content: string, ingredients: string): string {
  const fontSize = pickIngredientFontSize(ingredients);
  if (fontSize >= INGREDIENTS_FONT_MAX_HALF_POINTS) {
    return content;
  }
  const valueStart = content.indexOf("Ingredients:");
  const valueEnd = content.indexOf("</w:txbxContent>", valueStart);
  if (valueStart < 0 || valueEnd < 0) {
    return content;
  }
  const labelEnd = content.indexOf("</w:t>", valueStart) + "</w:t>".length;
  const beforeValue = content.slice(0, labelEnd);
  const value = content
    .slice(labelEnd, valueEnd)
    .replace(/<w:sz w:val="\d+"\/>/g, `<w:sz w:val="${fontSize}"/>`)
    .replace(/<w:szCs w:val="\d+"\/>/g, `<w:szCs w:val="${fontSize}"/>`);
  return beforeValue + value + content.slice(valueEnd);
}

function updateTextBox(
  documentXml: string,
  name: string,
  updater: (content: string) => string,
): string {
  const nameIndex = documentXml.indexOf(`name="${name}"`);
  if (nameIndex < 0) {
    throw new Error(`Template is missing ${name}.`);
  }
  const anchorStart = documentXml.lastIndexOf("<wp:anchor", nameIndex);
  const anchorEnd = documentXml.indexOf("</wp:anchor>", nameIndex);
  if (anchorStart < 0 || anchorEnd < 0) {
    throw new Error(`${name} is not inside a Word floating anchor.`);
  }
  const anchor = documentXml.slice(anchorStart, anchorEnd + "</wp:anchor>".length);
  const updatedAnchor = anchor.replace(
    /<w:txbxContent>[\s\S]*?<\/w:txbxContent>/g,
    updater,
  );
  return documentXml.slice(0, anchorStart) + updatedAnchor + documentXml.slice(anchorEnd + "</wp:anchor>".length);
}

function updateAnchorGeometry(
  documentXml: string,
  name: string,
  widthEmu: number,
  heightEmu: number,
): string {
  const nameIndex = documentXml.indexOf(`name="${name}"`);
  if (nameIndex < 0) {
    throw new Error(`Template is missing ${name}.`);
  }
  const anchorStart = documentXml.lastIndexOf("<wp:anchor", nameIndex);
  const anchorEnd = documentXml.indexOf("</wp:anchor>", nameIndex);
  const anchor = documentXml.slice(anchorStart, anchorEnd + "</wp:anchor>".length);
  const updatedAnchor = anchor
    .replace(/<wp:extent cx="\d+" cy="\d+"\/>/, `<wp:extent cx="${widthEmu}" cy="${heightEmu}"/>`)
    .replace(/<a:ext cx="\d+" cy="\d+"\/>/, `<a:ext cx="${widthEmu}" cy="${heightEmu}"/>`);
  return documentXml.slice(0, anchorStart) + updatedAnchor + documentXml.slice(anchorEnd + "</wp:anchor>".length);
}

function updateVerticalOffset(documentXml: string, name: string, offsetEmu: number): string {
  const nameIndex = documentXml.indexOf(`name="${name}"`);
  if (nameIndex < 0) {
    throw new Error(`Template is missing ${name}.`);
  }
  const anchorStart = documentXml.lastIndexOf("<wp:anchor", nameIndex);
  const anchorEnd = documentXml.indexOf("</wp:anchor>", nameIndex);
  const anchor = documentXml.slice(anchorStart, anchorEnd + "</wp:anchor>".length);
  const updatedAnchor = anchor.replace(
    /(<wp:positionV[^>]*>\s*<wp:posOffset>)\-?\d+(<\/wp:posOffset>)/,
    `$1${offsetEmu}$2`,
  );
  return documentXml.slice(0, anchorStart) + updatedAnchor + documentXml.slice(anchorEnd + "</wp:anchor>".length);
}

const TEXT_TAG = /<w:t(?: [^>]*)?>[\s\S]*?<\/w:t>/g;

function textValue(tag: string): string {
  return tag.replace(/^<w:t(?: [^>]*)?>|<\/w:t>$/g, "");
}

function replaceTextTag(tag: string, value: string): string {
  const openingEnd = tag.indexOf(">");
  return `${tag.slice(0, openingEnd + 1)}${escapeXml(value)}</w:t>`;
}

function replaceTextBox(documentXml: string, name: string, replacement: string): string {
  return updateTextBox(documentXml, name, (content) => {
    let first = true;
    return content.replace(TEXT_TAG, (tag) => {
      const value = first ? replacement : "";
      first = false;
      return replaceTextTag(tag, value);
    });
  });
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
