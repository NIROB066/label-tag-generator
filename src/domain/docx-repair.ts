import JSZip from "jszip";
import { scanDocxLabel } from "@/domain/barcode-scanner";

export type RepairOptions = {
  barcodeMediaFile?: string;
  newBarcodePng: Buffer;
  widthEmu?: number;
  heightEmu?: number;
  authoritativeBarcodeText?: string;
};

// Default high-clarity dimensions matching 3.4" x 0.70" (4.85:1 aspect ratio)
const DEFAULT_BARCODE_WIDTH_EMU = 3108960;
const DEFAULT_BARCODE_HEIGHT_EMU = 640080;
const SAFE_TEXT_BOX_OFFSET_EMU = 912114;

/**
 * Universally repairs a DOCX label by replacing its barcode media, aligning
 * geometry to prevent overlap, and updating human-readable text non-destructively.
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
  if (!targetMediaPath) {
    const scan = await scanDocxLabel(docxBytes);
    if (!scan.barcodeMediaFile) {
      throw new Error("No barcode image found in DOCX package to replace.");
    }
    targetMediaPath = scan.barcodeMediaFile;
  }

  // 1. Replace the barcode media image in the ZIP
  zip.file(targetMediaPath, options.newBarcodePng);

  // 2. Remove any accidental stray characters/paragraphs (e.g. stray "v" typed before barcode)
  documentXml = documentXml.replace(
    /<w:p[^>]*>\s*<w:r[^>]*>\s*<w:t>[vV]<\/w:t>\s*<\/w:r>\s*<\/w:p>/g,
    "",
  );

  // 3. Read relationships to find which Relationship ID embeds targetMediaPath
  const relsEntry = zip.file("word/_rels/document.xml.rels");
  let barcodeRelId: string | null = null;
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

  // 4. Update barcode drawing geometry & measure vertical boundary
  const targetW = options.widthEmu ?? DEFAULT_BARCODE_WIDTH_EMU;
  const targetH = options.heightEmu ?? DEFAULT_BARCODE_HEIGHT_EMU;
  let barcodeBottomEmu: number | null = null;

  if (barcodeRelId) {
    const blipRegex = new RegExp(
      `(<(?:wp:inline|wp:anchor)[\\s\\S]*?r:embed="${barcodeRelId}"[\\s\\S]*?<\\/(?:wp:inline|wp:anchor)>)`,
      "g",
    );

    documentXml = documentXml.replace(blipRegex, (drawingBlock) => {
      let updated = drawingBlock;

      // Extract existing Y offset if it is an anchor
      const posMatch = drawingBlock.match(
        /<wp:positionV[^>]*>\s*<wp:posOffset>(-?\d+)<\/wp:posOffset>/,
      );
      if (posMatch) {
        const top = Number(posMatch[1]);
        barcodeBottomEmu = top + targetH;
      }

      updated = updated.replace(
        /<wp:extent\s+cx="\d+"\s+cy="\d+"\/>/g,
        `<wp:extent cx="${targetW}" cy="${targetH}"/>`,
      );
      updated = updated.replace(
        /<a:ext\s+cx="\d+"\s+cy="\d+"\/>/g,
        `<a:ext cx="${targetW}" cy="${targetH}"/>`,
      );

      return updated;
    });
  }

  // 5. Eliminate overlap: ensure Text Box 7 or GS1 text box is placed below the barcode
  if (barcodeBottomEmu !== null) {
    const minSafeOffset = Math.max(barcodeBottomEmu + 25000, SAFE_TEXT_BOX_OFFSET_EMU);

    // Update Text Box 7 anchor posOffset if present
    const tbIdx = documentXml.indexOf("Text Box 7");
    if (tbIdx >= 0) {
      const aStart = documentXml.lastIndexOf("<wp:anchor", tbIdx);
      const aEnd = documentXml.indexOf("</wp:anchor>", tbIdx);
      if (aStart >= 0 && aEnd >= 0) {
        const block = documentXml.slice(aStart, aEnd + "</wp:anchor>".length);
        const currentPosMatch = block.match(
          /<wp:positionV[^>]*>\s*<wp:posOffset>(-?\d+)<\/wp:posOffset>/,
        );
        if (currentPosMatch && Number(currentPosMatch[1]) < minSafeOffset) {
          const updatedBlock = block.replace(
            /(<wp:positionV[^>]*>\s*<wp:posOffset>)-?\d+(<\/wp:posOffset>)/,
            `$1${minSafeOffset}$2`,
          );
          documentXml =
            documentXml.slice(0, aStart) +
            updatedBlock +
            documentXml.slice(aEnd + "</wp:anchor>".length);
        }
      }

      // Also adjust fallback VML shape margin-top if present
      documentXml = documentXml.replace(
        /(<v:shape[^>]+id="Text Box 7"[^>]+style="[^"]*margin-top:)[^;]+(;)/,
        `$168pt$2`,
      );
    }
  }

  // 6. Update the human-readable text underneath the barcode
  if (options.authoritativeBarcodeText) {
    const escaped = escapeXml(options.authoritativeBarcodeText);
    // Replace (01)... in <w:t>
    documentXml = documentXml.replace(
      /(<w:t(?: [^>]*)?>)\s*\(01\)\d{14}[^<]*(<\/w:t>)/g,
      `$1${escaped}$2`,
    );
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

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
