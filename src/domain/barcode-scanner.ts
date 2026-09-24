import JSZip from "jszip";
import sharp from "sharp";
import {
  MultiFormatOneDReader,
  DecodeHintType,
  RGBLuminanceSource,
  BinaryBitmap,
  HybridBinarizer,
} from "@zxing/library";
import { toBarcodeNumber } from "@/domain/gs1";
import { LabelScanResult, ScanStatus } from "@/domain/label-schema";
import { LABEL_TEMPLATE } from "@/domain/label-template";

const HINTS = new Map<DecodeHintType, unknown>([
  [DecodeHintType.TRY_HARDER, true],
]);

export type ScannedBarcode = {
  mediaPath: string;
  rawText: string;
  barcodeNumber: string;
  parsedGtin: string | null;
  parsedBestBefore: string | null;
  parsedLotCode: string | null;
  imageBase64: string;
  widthEmu?: number;
  heightEmu?: number;
};

/**
 * Scans a single image buffer for 1D barcodes (GS1-128, Code 128, etc.).
 * Flattens the image against a white background to handle transparency.
 */
export async function decodeBarcodeFromBuffer(
  buffer: Buffer | Uint8Array,
): Promise<{ text: string; base64: string } | null> {
  try {
    const image = sharp(buffer);
    const flattened = image.flatten({ background: "#ffffff" });
    const pngBuffer = await flattened.png().toBuffer();
    const { data: rawData, info } = await sharp(pngBuffer)
      .raw()
      .toBuffer({ resolveWithObject: true });

    const luminances = new Uint8ClampedArray(info.width * info.height);
    for (let i = 0; i < luminances.length; i++) {
      const r = rawData[i * 3];
      const g = rawData[i * 3 + 1];
      const b = rawData[i * 3 + 2];
      luminances[i] = (r * 306 + g * 601 + b * 117) >> 10;
    }

    const source = new RGBLuminanceSource(luminances, info.width, info.height);
    const bitmap = new BinaryBitmap(new HybridBinarizer(source));
    const reader = new MultiFormatOneDReader(HINTS);
    const result = reader.decode(bitmap);

    if (result && result.getText()) {
      return {
        text: result.getText(),
        base64: `data:image/png;base64,${pngBuffer.toString("base64")}`,
      };
    }
  } catch {
    // Decoding failed or image does not contain a barcode
  }

  return null;
}

/**
 * Scans an uploaded DOCX file for barcodes and extracts expected label fields.
 */
export async function scanDocxLabel(
  input: Uint8Array | Buffer,
  filename = "label.docx",
): Promise<LabelScanResult> {
  const zip = await JSZip.loadAsync(input, { checkCRC32: true });

  const docEntry = zip.file("word/document.xml");
  if (!docEntry) {
    return createErrorResult(filename, "DOCX package is missing word/document.xml.");
  }
  const documentXml = await docEntry.async("text");

  // Read relationships to map drawing rIds to media paths
  const relsEntry = zip.file("word/_rels/document.xml.rels");
  const relsMap = new Map<string, string>();
  if (relsEntry) {
    const relsXml = await relsEntry.async("text");
    const relRegex = /<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"/g;
    let match: RegExpExecArray | null;
    while ((match = relRegex.exec(relsXml)) !== null) {
      const id = match[1];
      const target = match[2];
      relsMap.set(id, target.startsWith("word/") ? target : `word/${target}`);
    }
  }

  // Extract expected fields from document text
  const extracted = extractFieldsFromDocument(documentXml);

  // Scan all media images in word/media/
  const mediaFiles = Object.keys(zip.files).filter(
    (name) => name.startsWith("word/media/") && !zip.files[name].dir,
  );

  let barcodeMatch: ScannedBarcode | null = null;

  for (const mediaPath of mediaFiles) {
    const fileEntry = zip.file(mediaPath);
    if (!fileEntry) continue;

    const buffer = await fileEntry.async("nodebuffer");
    const decoded = await decodeBarcodeFromBuffer(buffer);
    if (decoded) {
      const parsed = parseScannedBarcode(decoded.text);
      const dimensions = extractDrawingDimensions(documentXml, relsMap, mediaPath);

      barcodeMatch = {
        mediaPath,
        rawText: decoded.text,
        barcodeNumber: toBarcodeNumber(decoded.text),
        parsedGtin: parsed.gtin,
        parsedBestBefore: parsed.bestBefore,
        parsedLotCode: parsed.lotCode,
        imageBase64: decoded.base64,
        widthEmu: dimensions?.widthEmu,
        heightEmu: dimensions?.heightEmu,
      };
      break;
    }
  }

  return evaluateScanResult(filename, extracted, barcodeMatch);
}

function extractTextBoxText(documentXml: string, boxName: string): string {
  const match = documentXml.match(
    new RegExp(
      `<wp:docPr[^>]+name="${boxName}"[\\s\\S]*?<w:txbxContent>([\\s\\S]*?)<\\/w:txbxContent>`,
    ),
  );
  if (!match) {
    return "";
  }
  return match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractFieldsFromDocument(documentXml: string) {
  // Extract text per paragraph so contiguous runs in Word are joined seamlessly
  const paragraphMatches = documentXml.match(/<w:p[\s\S]*?<\/w:p>/g) || [];
  const paragraphs = paragraphMatches.map((p) => {
    return (p.match(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g) || [])
      .map((tag) => tag.replace(/^<w:t(?: [^>]*)?>|<\/w:t>$/g, ""))
      .join("");
  });

  const cleanText = paragraphs.join(" ").replace(/\s+/g, " ").trim();

  // Extract GTIN: check docPr descr first, then visible text (01)10627146285749 or 14-digit GTIN
  const descrMatch = documentXml.match(/<wp:docPr[^>]+descr="[^"]*\(01\)(\d{14})/);
  const gtinMatch = descrMatch || cleanText.match(/\(01\)(\d{14})/) || cleanText.match(/\b(\d{14})\b/);
  const expectedGtin = gtinMatch ? gtinMatch[1] : "";

  // Extract Lot Code: LOT CODE: 72722 or (10)72722
  const lotMatch =
    cleanText.match(/LOT\s*CODE\s*:\s*([A-Za-z0-9]+)/i) ||
    cleanText.match(/\(10\)([A-Za-z0-9]+)/);
  const expectedLotCode = lotMatch ? lotMatch[1] : "";

  // Extract Best Before: BEST BEFORE: 2025/09/23 or (15)250923
  let expectedBestBefore = "";
  const dateMatch = cleanText.match(/BEST\s*BEFORE\s*:\s*(\d{4})[\/\-](\d{2})[\/\-](\d{2})/i);
  if (dateMatch) {
    expectedBestBefore = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
  } else {
    const ai15Match = cleanText.match(/\(15\)(\d{2})(\d{2})(\d{2})/);
    if (ai15Match) {
      expectedBestBefore = `20${ai15Match[1]}-${ai15Match[2]}-${ai15Match[3]}`;
    }
  }

  // Extract Product Name
  let productName = extractTextBoxText(documentXml, LABEL_TEMPLATE.textBoxes.productName);
  if (!productName) {
    // Check paragraphs: in Issue docx, title is usually the 2nd paragraph after company header
    const nonHeader = paragraphs.filter(
      (p) =>
        p &&
        !p.toUpperCase().includes("GASTRONOMIQUE") &&
        !p.startsWith("ITEM") &&
        !p.includes("KEEP FROZEN") &&
        !p.includes("Ingredients") &&
        !p.includes("LOT CODE"),
    );
    productName = nonHeader[0] || "Food Label";
  }

  // Extract Item Number
  const itemMatch = cleanText.match(/ITEM\s*#?\s*([A-Za-z0-9]+)/i);
  const itemNumber = itemMatch ? itemMatch[1] : "";

  // Extract storage instruction and ingredients so repairs preserve them
  const storageInstruction = extractTextBoxText(
    documentXml,
    LABEL_TEMPLATE.textBoxes.storageInstruction,
  );
  const ingredients = extractTextBoxText(
    documentXml,
    LABEL_TEMPLATE.textBoxes.ingredients,
  ).replace(/^Ingredients:\s*/i, "");

  const expectedBarcodeText = expectedGtin
    ? `(01)${expectedGtin}${expectedBestBefore ? `(15)${expectedBestBefore.replaceAll("-", "").slice(2)}` : ""}${expectedLotCode ? `(10)${expectedLotCode}` : ""}`
    : cleanText.match(/\(01\)\d{14}[^\s<]*/)?.[0] || "";

  return {
    productName,
    itemNumber,
    expectedGtin,
    expectedLotCode,
    expectedBestBefore,
    expectedIngredients: ingredients,
    expectedStorageInstruction: storageInstruction,
    expectedBarcodeText,
    expectedBarcodeNumber: expectedBarcodeText ? toBarcodeNumber(expectedBarcodeText) : null,
  };
}

function parseScannedBarcode(text: string) {
  let gtin: string | null = null;
  let bestBefore: string | null = null;
  let lotCode: string | null = null;

  // Format 1: (01)10627146285749(15)250923(10)72722
  if (text.includes("(01)")) {
    const gMatch = text.match(/\(01\)(\d{14})/);
    if (gMatch) gtin = gMatch[1];

    const dMatch = text.match(/\(15\)(\d{6})/);
    if (dMatch) bestBefore = `20${dMatch[1].slice(0, 2)}-${dMatch[1].slice(2, 4)}-${dMatch[1].slice(4, 6)}`;

    const lMatch = text.match(/\(10\)([A-Za-z0-9]+)/);
    if (lMatch) lotCode = lMatch[1];
  }
  // Format 2: 0110627146285749152509231072722
  else if (text.startsWith("01") && text.length >= 16) {
    gtin = text.slice(2, 16);
    let remaining = text.slice(16);

    if (remaining.startsWith("15") && remaining.length >= 8) {
      const datePart = remaining.slice(2, 8);
      bestBefore = `20${datePart.slice(0, 2)}-${datePart.slice(2, 4)}-${datePart.slice(4, 6)}`;
      remaining = remaining.slice(8);
    }

    if (remaining.startsWith("10")) {
      lotCode = remaining.slice(2);
    }
  }
  // Format 3: pure 14-digit GTIN
  else if (/^\d{14}$/.test(text)) {
    gtin = text;
  }

  return { gtin, bestBefore, lotCode };
}

function extractDrawingDimensions(
  documentXml: string,
  relsMap: Map<string, string>,
  mediaPath: string,
) {
  // Find which relId points to mediaPath
  let targetRelId: string | null = null;
  for (const [rId, target] of relsMap.entries()) {
    if (target === mediaPath || mediaPath.endsWith(target)) {
      targetRelId = rId;
      break;
    }
  }
  if (!targetRelId) return null;

  const blipPattern = new RegExp(
    `(<(?:wp:inline|wp:anchor)[\\s\\S]*?r:embed="${targetRelId}"[\\s\\S]*?<\\/(?:wp:inline|wp:anchor)>)`,
  );
  const match = documentXml.match(blipPattern);
  if (!match) return null;

  const extentMatch = match[1].match(/<wp:extent\s+cx="(\d+)"\s+cy="(\d+)"/);
  if (!extentMatch) return null;

  return {
    widthEmu: Number(extentMatch[1]),
    heightEmu: Number(extentMatch[2]),
  };
}

function evaluateScanResult(
  filename: string,
  extracted: ReturnType<typeof extractFieldsFromDocument>,
  barcode: ScannedBarcode | null,
): LabelScanResult {
  const mismatches: LabelScanResult["mismatches"] = [];

  const baseResult = {
    filename,
    productName: extracted.productName,
    itemNumber: extracted.itemNumber,
    expectedGtin: extracted.expectedGtin,
    expectedLotCode: extracted.expectedLotCode,
    expectedBestBefore: extracted.expectedBestBefore,
    expectedIngredients: extracted.expectedIngredients,
    expectedStorageInstruction: extracted.expectedStorageInstruction,
    expectedBarcodeText: extracted.expectedBarcodeText,
    expectedBarcodeNumber: extracted.expectedBarcodeNumber,
    barcodeMediaFile: barcode?.mediaPath ?? null,
    barcodeImageBase64: barcode?.imageBase64 ?? null,
  };

  if (!barcode) {
    return {
      ...baseResult,
      scannedRaw: null,
      scannedBarcodeNumber: null,
      scannedGtin: null,
      scannedLotCode: null,
      scannedBestBefore: null,
      status: "error",
      detail: "No scannable 1D barcode was detected in the document images.",
      mismatches: [
        {
          field: "Barcode Artwork",
          expected: extracted.expectedBarcodeNumber || "Scannable GTIN barcode",
          actual: "Not detected",
          message: "Barcode image is missing or unreadable.",
          code: "BARCODE_NOT_FOUND",
        },
      ],
    };
  }

  const { parsedGtin, parsedBestBefore, parsedLotCode, rawText, barcodeNumber } = barcode;

  // The number written on the document is the truth. Every expected component
  // must be present in the scanned artwork and match exactly.

  // GTIN check
  if (extracted.expectedGtin && parsedGtin) {
    if (extracted.expectedGtin !== parsedGtin) {
      mismatches.push({
        field: "GTIN / Barcode Number",
        expected: extracted.expectedGtin,
        actual: parsedGtin,
        message: `Scanned GTIN ${parsedGtin} does not match expected ${extracted.expectedGtin}.`,
        code: "BARCODE_VALUE_MISMATCH",
      });
    }
  } else if (extracted.expectedGtin && !parsedGtin) {
    mismatches.push({
      field: "GTIN / Barcode Number",
      expected: extracted.expectedGtin,
      actual: rawText,
      message: `Could not parse valid GTIN from scanned text: "${rawText}".`,
      code: "BARCODE_UNREADABLE",
    });
  }

  // Best-before check (written date is the truth; a missing scanned date is an error)
  if (extracted.expectedBestBefore) {
    if (!parsedBestBefore) {
      mismatches.push({
        field: "Best Before Date",
        expected: extracted.expectedBestBefore,
        actual: "Missing from barcode",
        message:
          "The barcode artwork does not contain a best-before date ((15) AI) matching the written label date.",
        code: "BEST_BEFORE_MISMATCH",
      });
    } else if (parsedBestBefore !== extracted.expectedBestBefore) {
      mismatches.push({
        field: "Best Before Date",
        expected: extracted.expectedBestBefore,
        actual: parsedBestBefore,
        message: `Scanned date ${parsedBestBefore} does not match expected ${extracted.expectedBestBefore}.`,
        code: "BEST_BEFORE_MISMATCH",
      });
    }
  }

  // Lot check (written lot is the truth; a missing scanned lot is an error)
  if (extracted.expectedLotCode) {
    if (!parsedLotCode) {
      mismatches.push({
        field: "Lot Code",
        expected: extracted.expectedLotCode,
        actual: "Missing from barcode",
        message:
          "The barcode artwork does not contain a lot code ((10) AI) matching the written label lot.",
        code: "LOT_MISMATCH",
      });
    } else if (parsedLotCode !== extracted.expectedLotCode) {
      mismatches.push({
        field: "Lot Code",
        expected: extracted.expectedLotCode,
        actual: parsedLotCode,
        message: `Scanned lot ${parsedLotCode} does not match expected ${extracted.expectedLotCode}.`,
        code: "LOT_MISMATCH",
      });
    }
  }

  // Full barcode number check catches any remaining difference (extra or
  // missing AIs, truncated values, swapped components) even when each parsed
  // component individually matches.
  if (
    extracted.expectedBarcodeNumber &&
    barcodeNumber &&
    extracted.expectedBarcodeNumber !== barcodeNumber
  ) {
    mismatches.push({
      field: "Full Barcode Number",
      expected: extracted.expectedBarcodeNumber,
      actual: barcodeNumber,
      message: `Scanned barcode number ${barcodeNumber} does not equal the written barcode number ${extracted.expectedBarcodeNumber}.`,
      code: "BARCODE_VALUE_MISMATCH",
    });
  }

  const status: ScanStatus = mismatches.length > 0 ? "attention" : "ready";
  const detail =
    mismatches.length > 0
      ? mismatches.map((m) => m.message).join(" ")
      : "Scanned barcode matches the written barcode number, lot code, and best-before date.";

  return {
    ...baseResult,
    scannedRaw: rawText,
    scannedBarcodeNumber: barcodeNumber,
    scannedGtin: parsedGtin,
    scannedLotCode: parsedLotCode,
    scannedBestBefore: parsedBestBefore,
    status,
    detail,
    mismatches,
    widthEmu: barcode.widthEmu,
    heightEmu: barcode.heightEmu,
  };
}

function createErrorResult(filename: string, message: string): LabelScanResult {
  return {
    filename,
    productName: "Unreadable label",
    itemNumber: "",
    expectedGtin: "",
    expectedLotCode: "",
    expectedBestBefore: "",
    expectedIngredients: "",
    expectedStorageInstruction: "",
    expectedBarcodeText: "",
    expectedBarcodeNumber: null,
    scannedRaw: null,
    scannedBarcodeNumber: null,
    scannedGtin: null,
    scannedLotCode: null,
    scannedBestBefore: null,
    barcodeMediaFile: null,
    barcodeImageBase64: null,
    status: "error",
    detail: message,
    mismatches: [
      {
        field: "DOCX Structure",
        expected: "Valid DOCX package",
        actual: "Failed",
        message,
      },
    ],
  };
}
