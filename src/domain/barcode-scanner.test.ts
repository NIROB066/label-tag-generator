import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import bwipjs from "bwip-js";
import { scanDocxLabel } from "./barcode-scanner";

async function barcodePng(gs1Text: string): Promise<Buffer> {
  return bwipjs.toBuffer({
    bcid: "gs1-128",
    text: gs1Text,
    scale: 4,
    height: 15,
    includetext: false,
    monochrome: true,
    paddingwidth: 10,
    paddingheight: 4,
  });
}

/**
 * Builds a minimal DOCX whose written text declares the truth
 * (LOT CODE 99999, BEST BEFORE 2027/01/02) and whose embedded artwork
 * encodes whatever GS1 string is passed in.
 */
async function syntheticLabelDocx(artworkGs1Text: string): Promise<Buffer> {
  const png = await barcodePng(artworkGs1Text);
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:t>LOT CODE: 99999 BEST BEFORE: 2027/01/02 (01)10627146285749(15)270102(10)99999 Ingredients: Eggs, sugar, wheat flour.</w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>`;

  const zip = new JSZip();
  zip.file("word/document.xml", documentXml);
  zip.file("word/media/image1.png", png);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("scanDocxLabel", () => {
  it("flags Lava Cake sample artwork that omits the written date and lot", async () => {
    const file = await readFile(
      path.join(process.cwd(), "sample", "Lava Cake Label 6''x4''.docx"),
    );
    const result = await scanDocxLabel(file, "Lava Cake Label 6''x4''.docx");

    // The sample artwork only encodes the GTIN, while the label text also
    // writes (15)270215 and (10)26815. The written number is the truth, so
    // every missing component must be detected as an error.
    expect(result.scannedGtin).toBe("10627146285749");
    expect(result.expectedGtin).toBe("10627146285749");
    expect(result.expectedLotCode).toBe("26815");
    expect(result.expectedBestBefore).toBe("2027-02-15");
    expect(result.status).toBe("attention");

    const fields = result.mismatches.map((m) => m.field);
    expect(fields).toContain("Best Before Date");
    expect(fields).toContain("Lot Code");
    expect(fields).toContain("Full Barcode Number");
    expect(result.scannedBarcodeNumber).toBe("0110627146285749");
    expect(result.expectedBarcodeNumber).toBe("0110627146285749152702151026815");
    expect(result.barcodeMediaFile).toBe("word/media/image2.png");
    expect(result.barcodeImageBase64).toContain("data:image/png;base64,");

    // Repairs must be able to preserve the remaining label content.
    expect(result.expectedIngredients).toContain("Eggs");
    expect(result.expectedStorageInstruction).toContain("KEEP FROZEN");
  });

  it("detects GTIN mismatch on Raspberry cheesecake sample", async () => {
    const file = await readFile(
      path.join(
        process.cwd(),
        "sample",
        "Raspberry cheesecake  Label (6''x4'').docx",
      ),
    );
    const result = await scanDocxLabel(
      file,
      "Raspberry cheesecake  Label (6''x4'').docx",
    );

    // Document expected GTIN is 10759242722054, but scanned artwork has 10627146285572!
    expect(result.expectedGtin).toBe("10759242722054");
    expect(result.scannedGtin).toBe("10627146285572");
    expect(result.status).toBe("attention");
    expect(result.mismatches.length).toBeGreaterThan(0);
    expect(result.mismatches[0].field).toBe("GTIN / Barcode Number");
    expect(result.mismatches[0].code).toBe("BARCODE_VALUE_MISMATCH");
    expect(result.barcodeMediaFile).toBe("word/media/image2.png");
    expect(result.scannedBarcodeNumber).toBeTruthy();
  });

  it("scans inline drawing barcode on Issue/Lava-Cake-3-Inch.docx", async () => {
    const file = await readFile(
      path.join(process.cwd(), "Issue", "Lava-Cake-3-Inch.docx"),
    );
    const result = await scanDocxLabel(file, "Lava-Cake-3-Inch.docx");

    expect(result.expectedGtin).toBe("10627146285749");
    expect(result.scannedGtin).toBe("10627146285749");
    expect(result.status).toBe("ready");
    expect(result.scannedBarcodeNumber).toBe(result.expectedBarcodeNumber);
    expect(result.barcodeMediaFile).toBe(
      "word/media/image2.png",
    );
  });

  it("reports ready with zero mismatches when artwork matches the written truth", async () => {
    const docx = await syntheticLabelDocx("(01)10627146285749(15)270102(10)99999");
    const result = await scanDocxLabel(docx, "matching.docx");

    expect(result.status).toBe("ready");
    expect(result.mismatches).toHaveLength(0);
    expect(result.expectedBarcodeNumber).toBe("0110627146285749152701021099999");
    expect(result.scannedBarcodeNumber).toBe("0110627146285749152701021099999");
    expect(result.scannedLotCode).toBe("99999");
    expect(result.scannedBestBefore).toBe("2027-01-02");
  });

  it("detects best-before and lot mismatches individually with stable codes", async () => {
    const docx = await syntheticLabelDocx("(01)10627146285749(15)260510(10)11111");
    const result = await scanDocxLabel(docx, "wrong-date-lot.docx");

    expect(result.status).toBe("attention");
    const fields = result.mismatches.map((m) => m.field);

    expect(fields).toContain("Best Before Date");
    expect(result.mismatches.find((m) => m.field === "Best Before Date")?.code).toBe(
      "BEST_BEFORE_MISMATCH",
    );
    expect(result.mismatches.find((m) => m.field === "Best Before Date")?.actual).toBe("2026-05-10");

    expect(fields).toContain("Lot Code");
    expect(result.mismatches.find((m) => m.field === "Lot Code")?.code).toBe("LOT_MISMATCH");

    // GTIN matches, so no GTIN mismatch may be reported.
    expect(fields).not.toContain("GTIN / Barcode Number");

    // The full barcode number compare must also flag the difference.
    expect(fields).toContain("Full Barcode Number");
    expect(result.scannedBarcodeNumber).not.toBe(result.expectedBarcodeNumber);
  });

  it("treats a barcode missing the best-before date as an error", async () => {
    const docx = await syntheticLabelDocx("(01)10627146285749(10)99999");
    const result = await scanDocxLabel(docx, "missing-date.docx");

    expect(result.status).toBe("attention");
    const dateMismatch = result.mismatches.find((m) => m.field === "Best Before Date");
    expect(dateMismatch).toBeDefined();
    expect(dateMismatch?.code).toBe("BEST_BEFORE_MISMATCH");
    expect(dateMismatch?.actual).toBe("Missing from barcode");

    // Lot and GTIN still match.
    expect(result.mismatches.map((m) => m.field)).not.toContain("GTIN / Barcode Number");
    expect(result.mismatches.map((m) => m.field)).not.toContain("Lot Code");
  });
});
