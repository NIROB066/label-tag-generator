import JSZip from "jszip";
import { toBarcodeNumber } from "@/domain/gs1";
import { scanDocxLabel } from "@/domain/barcode-scanner";

export type RepairOptions = {
  barcodeMediaFile?: string;
  newBarcodePng: Buffer;
  /**
   * Optional explicit barcode size in EMU. When omitted (the default repair
   * path), the barcode keeps the exact size and position detected in the
   * uploaded document, so nothing else on the label can shift.
   */
  widthEmu?: number;
  heightEmu?: number;
  authoritativeBarcodeText?: string;
  /** Authoritative lot code; LOT CODE text is patched in place only when it differs. */
  lotCode?: string;
  /** Authoritative best-before (YYYY-MM-DD); BEST BEFORE text is patched only when it differs. */
  bestBefore?: string;
};

/**
 * Surgically repairs a DOCX label in place: swaps the barcode artwork, syncs
 * the human-readable barcode number, and corrects LOT CODE / BEST BEFORE text
 * when they disagree with the authoritative values. Title, ingredients,
 * fonts, geometry, and every other element of the uploaded document are left
 * untouched.
 */
export async function repairDocxBarcode(
  docxBytes: Uint8Array | Buffer,
  options: RepairOptions,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docxBytes, { checkCRC32: true });

  const docEntry = zip.file("word/document.xml");
  if (!docEntry) {
    throw new Error("Invalid DOCX package: missing word/document.xml.");
  }
  let documentXml = await docEntry.async("text");

  // If barcodeMediaFile is not provided, scan to detect it
  let targetMediaPath = options.barcodeMediaFile;
  let barcodeRelId: string | null = null;
  if (!targetMediaPath) {
    const scan = await scanDocxLabel(docxBytes);
    if (!scan.barcodeMediaFile) {
      throw new Error("No barcode image found in DOCX package to replace.");
    }
    targetMediaPath = scan.barcodeMediaFile;
  }

  // 1. Replace the barcode media image in the ZIP
  zip.file(targetMediaPath, options.newBarcodePng);

  // 2. Blank stray single-character paragraphs (e.g. a "v" typed before the
  //    barcode) without deleting them: paragraph-relative anchors below keep
  //    their baseline, so the barcode stays under the ingredients box.
  documentXml = documentXml.replace(
    /(<w:p[^>]*>\s*<w:r[^>]*>\s*<w:t>)[vV](<\/w:t>\s*<\/w:r>\s*<\/w:p>)/g,
    "$1$2",
  );

  // 3. Read relationships to find which Relationship ID embeds targetMediaPath
  const relsEntry = zip.file("word/_rels/document.xml.rels");
  if (relsEntry) {
    const relsXml = await relsEntry.async("text");
    const relRegex = /<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"/g;
    let match: RegExpExecArray | null;
    while ((match = relRegex.exec(relsXml)) !== null) {
      const id = match[1];
      const target = match[2];
      const normalizedTarget = target.startsWith("word/") ? target : `word/${target}`;
      if (normalizedTarget === targetMediaPath || targetMediaPath.endsWith(target)) {
        barcodeRelId = id;
        break;
      }
    }
  }

  // 4. Optional explicit resize. Without width/height the detected geometry
  //    (size AND position) is preserved exactly, including the VML fallback.
  if (barcodeRelId && options.widthEmu && options.heightEmu) {
    const { widthEmu, heightEmu } = options;

    const blipRegex = new RegExp(
      `(<(?:wp:inline|wp:anchor)[\\s\\S]*?r:embed="${barcodeRelId}"[\\s\\S]*?<\\/(?:wp:inline|wp:anchor)>)`,
      "g",
    );
    documentXml = documentXml.replace(blipRegex, (drawingBlock) =>
      drawingBlock
        .replace(/<wp:extent\s+cx="\d+"\s+cy="\d+"\/>/g, `<wp:extent cx="${widthEmu}" cy="${heightEmu}"/>`)
        .replace(/<a:ext\s+cx="\d+"\s+cy="\d+"\/>/g, `<a:ext cx="${widthEmu}" cy="${heightEmu}"/>`),
    );

    // Mirror the size into the VML fallback shape so old Word versions agree.
    const widthPt = (widthEmu / 12700).toFixed(2);
    const heightPt = (heightEmu / 12700).toFixed(2);
    const vmlBlockRegex = new RegExp(
      `<v:shape[^>]*>(?:(?!<\\/v:shape>)[\\s\\S])*?<v:imagedata[^>]+r:id="${barcodeRelId}"[\\s\\S]*?<\\/v:shape>`,
      "g",
    );
    documentXml = documentXml.replace(vmlBlockRegex, (shapeBlock) =>
      shapeBlock
        .replace(/(style="[^"]*width:)[\d.]+pt/, `$1${widthPt}pt`)
        .replace(/(style="[^"]*height:)[\d.]+pt/, `$1${heightPt}pt`),
    );
  }

  // 5. Sync the human-readable barcode number under the artwork
  if (options.authoritativeBarcodeText) {
    const escaped = escapeXml(options.authoritativeBarcodeText);
    // Rewrite the (01)... number in <w:t> even when Word split it across
    // several runs (editing in Word fragments the run), consuming leftover
    // fragments so no extra digits survive next to the new number.
    documentXml = replaceHumanReadableBarcodeNumber(documentXml, options.authoritativeBarcodeText);
    // Also update descr="(01)..." if present
    documentXml = documentXml.replace(
      /descr="\(01\)\d{14}[^"]*"/g,
      `descr="${escaped}"`,
    );
    // Also update alt="(01)..." in VML shapes if present
    documentXml = documentXml.replace(
      /alt="\(01\)\d{14}[^"]*"/g,
      `alt="${escaped}"`,
    );
  }

  // 6. Correct wrong LOT CODE / BEST BEFORE text in place, preserving formatting
  if (options.lotCode !== undefined) {
    documentXml = patchLabeledValue(documentXml, /\bLOT\s*CODE\b/i, /^[A-Za-z0-9]*/, options.lotCode);
  }
  if (options.bestBefore !== undefined) {
    const date = options.bestBefore.replaceAll("-", "/");
    documentXml = patchLabeledValue(documentXml, /\bBEST\s*BEFORE\b/i, /^[0-9/\-]+/, date);
  }

  // 7. Remove any document protection or read-only settings
  documentXml = documentXml
    .replace(/<w:documentProtection[^>]*\/>/g, "")
    .replace(/<w:writeProtection[^>]*\/>/g, "")
    .replace(/<w:readOnlyRecommended\/>/g, "");

  const settingsEntry = zip.file("word/settings.xml");
  if (settingsEntry) {
    let settingsXml = await settingsEntry.async("text");
    settingsXml = settingsXml
      .replace(/<w:documentProtection[^>]*\/>/g, "")
      .replace(/<w:writeProtection[^>]*\/>/g, "")
      .replace(/<w:readOnlyRecommended\/>/g, "");
    zip.file("word/settings.xml", settingsXml);
  }

  zip.file("word/document.xml", documentXml);

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    platform: "UNIX",
  });
}

/** Matches innermost paragraphs only (text-box paragraphs nest inside body paragraphs). */
const INNERMOST_PARAGRAPH = /<w:p(?: [^>]*)?>(?:(?!<w:p[ >])[\s\S])*?<\/w:p>/g;
const TEXT_TAG_GLOBAL = /<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g;

/**
 * Rewrites the value that follows a text label such as "LOT CODE:" or
 * "BEST BEFORE:" inside every matching paragraph, no matter how Word split
 * the value across runs. When the existing value already equals the new one
 * the paragraph is left byte-for-byte untouched.
 */
function patchLabeledValue(
  documentXml: string,
  labelRegex: RegExp,
  valueRegex: RegExp,
  newValue: string,
): string {
  return documentXml.replace(INNERMOST_PARAGRAPH, (paragraph) => {
    const tags: Array<{ start: number; end: number; value: string; charStart: number }> = [];
    TEXT_TAG_GLOBAL.lastIndex = 0;
    let match: RegExpExecArray | null;
    let charOffset = 0;
    while ((match = TEXT_TAG_GLOBAL.exec(paragraph)) !== null) {
      tags.push({
        start: match.index,
        end: match.index + match[0].length,
        value: match[1],
        charStart: charOffset,
      });
      charOffset += match[1].length;
    }
    if (tags.length === 0) {
      return paragraph;
    }

    const joined = tags.map((tag) => tag.value).join("");
    TEXT_TAG_GLOBAL.lastIndex = 0;
    const labelMatch = labelRegex.exec(joined);
    if (!labelMatch) {
      return paragraph;
    }

    const afterLabel = joined.slice(labelMatch.index + labelMatch[0].length);
    const separator = afterLabel.match(/^\s*:?\s*/);
    const separatorStr = separator ? separator[0] : "";
    const separatorLength = separatorStr.length;
    const valueStart = labelMatch.index + labelMatch[0].length + separatorLength;
    const valueMatch = valueRegex.exec(afterLabel.slice(separatorLength));
    const currentValue = valueMatch ? valueMatch[0] : "";

    // Exactly one space goes between the label's colon and the value. When
    // the separator already provided one in an untouched run, the value is
    // written plain; otherwise the space is written with the value.
    const separatorAfterColon = separatorStr.includes(":")
      ? separatorStr.slice(separatorStr.indexOf(":") + 1)
      : separatorStr;
    const spaceRemainsBeforeValue = /\s/.test(separatorAfterColon);

    if (
      normalizeValue(currentValue) === normalizeValue(newValue) &&
      (spaceRemainsBeforeValue || currentValue === "")
    ) {
      return paragraph; // already correct with proper spacing — leave untouched
    }

    const valueEnd = valueStart + currentValue.length;
    const replacements: Array<{ start: number; end: number; text: string }> = [];
    let written = false;

    for (const tag of tags) {
      const charStart = tag.charStart;
      const charEnd = charStart + tag.value.length;
      const overlapsValue = charStart < valueEnd && charEnd > valueStart;

      if (overlapsValue) {
        const prefix = tag.value.slice(0, Math.max(0, valueStart - charStart)).replace(/\s+$/, "");
        const suffix = charEnd > valueEnd ? tag.value.slice(valueEnd - charStart) : "";
        const glue = prefix.length > 0 || !spaceRemainsBeforeValue ? " " : "";
        replacements.push({
          start: tag.start,
          end: tag.end,
          text: `${escapeXml(prefix)}${written ? "" : `${glue}${escapeXml(newValue)}`}${escapeXml(suffix)}`,
        });
        written = true;
      } else if (!written && charEnd <= valueStart && currentValue === "") {
        replacements.push({
          start: tag.start,
          end: tag.end,
          text: `${escapeXml(tag.value.replace(/\s+$/, ""))} ${escapeXml(newValue)}`,
        });
        written = true;
      }
    }

    if (!written) {
      return paragraph;
    }

    let patched = paragraph;
    for (let index = replacements.length - 1; index >= 0; index -= 1) {
      const replacement = replacements[index];
      const wholeTag = patched.slice(replacement.start, replacement.end);
      const openingEnd = wholeTag.indexOf(">");
      let opening = wholeTag.slice(0, openingEnd + 1);
      if (/^\s|\s$/.test(replacement.text) && !opening.includes("xml:space")) {
        opening = opening.replace("<w:t", '<w:t xml:space="preserve"');
      }
      const newTag = `${opening}${replacement.text}</w:t>`;
      patched = patched.slice(0, replacement.start) + newTag + patched.slice(replacement.end);
    }
    return patched;
  });
}

function normalizeValue(value: string): string {
  return value.replace(/[\s\-]/g, "").toUpperCase();
}

/**
 * Rewrites the human-readable "(01)...(15)...(10)..." number inside every
 * paragraph that contains it, no matter how Word split it across runs: the
 * first covering run receives the full new number and the remaining
 * fragments are cleared, so no leftover digits survive an edit.
 */
function replaceHumanReadableBarcodeNumber(
  documentXml: string,
  authoritativeText: string,
): string {
  return documentXml.replace(INNERMOST_PARAGRAPH, (paragraph) => {
    const tags: Array<{ start: number; end: number; value: string; charStart: number }> = [];
    TEXT_TAG_GLOBAL.lastIndex = 0;
    let match: RegExpExecArray | null;
    let charOffset = 0;
    while ((match = TEXT_TAG_GLOBAL.exec(paragraph)) !== null) {
      tags.push({
        start: match.index,
        end: match.index + match[0].length,
        value: match[1],
        charStart: charOffset,
      });
      charOffset += match[1].length;
    }
    if (tags.length === 0) {
      return paragraph;
    }

    const joined = tags.map((tag) => tag.value).join("");
    TEXT_TAG_GLOBAL.lastIndex = 0;
    const numberMatch = joined.match(/\(01\)\d{14}[^\s]*/);
    if (!numberMatch) {
      return paragraph;
    }
    if (toBarcodeNumber(numberMatch[0]) === toBarcodeNumber(authoritativeText)) {
      return paragraph; // already correct — leave the runs untouched
    }

    const valueStart = numberMatch.index ?? 0;
    const valueEnd = valueStart + numberMatch[0].length;
    const replacements: Array<{ start: number; end: number; text: string }> = [];
    let written = false;

    for (const tag of tags) {
      const charStart = tag.charStart;
      const charEnd = charStart + tag.value.length;
      if (charStart >= valueEnd || charEnd <= valueStart) {
        continue;
      }
      const prefix = tag.value.slice(0, Math.max(0, valueStart - charStart));
      const suffix = charEnd > valueEnd ? tag.value.slice(valueEnd - charStart) : "";
      replacements.push({
        start: tag.start,
        end: tag.end,
        text: `${escapeXml(prefix)}${written ? "" : escapeXml(authoritativeText)}${escapeXml(suffix)}`,
      });
      written = true;
    }

    if (!written) {
      return paragraph;
    }

    let patched = paragraph;
    for (let index = replacements.length - 1; index >= 0; index -= 1) {
      const replacement = replacements[index];
      const wholeTag = patched.slice(replacement.start, replacement.end);
      const openingEnd = wholeTag.indexOf(">");
      let opening = wholeTag.slice(0, openingEnd + 1);
      if (/^\s|\s$/.test(replacement.text) && !opening.includes("xml:space")) {
        opening = opening.replace("<w:t", '<w:t xml:space="preserve"');
      }
      const newTag = `${opening}${replacement.text}</w:t>`;
      patched = patched.slice(0, replacement.start) + newTag + patched.slice(replacement.end);
    }
    return patched;
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
