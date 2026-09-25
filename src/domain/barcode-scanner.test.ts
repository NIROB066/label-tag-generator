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

    // The sample artwork only encodes the GTIN, while the written number is
    // (01)10627146285749(15)250923(10)72722. The written number is the truth,
    // so every missing component must be detected as an error.
    expect(result.scannedGtin).toBe("10627146285749");
    expect(result.expectedGtin).toBe("10627146285749");
    expect(result.expectedLotCode).toBe("72722");
    expect(result.expectedBestBefore).toBe("2025-09-23");
    expect(result.status).toBe("attention");

    const fields = result.mismatches.map((m) => m.field);
    expect(fields).toContain("Best Before Date");
    expect(fields).toContain("Lot Code");
    expect(fields).toContain("Full Barcode Number");
    // The LOT CODE / BEST BEFORE text lines disagree with the written number.
    expect(fields).toContain("Best Before Text");
    expect(fields).toContain("Lot Code Text");
    expect(result.scannedBarcodeNumber).toBe("0110627146285749");
    expect(result.expectedBarcodeNumber).toBe("0110627146285749152509231072722");
    expect(result.barcodeMediaFile).toBe("word/media/image2.png");
    expect(result.barcodeImageBase64).toContain("data:image/png;base64,");

    // Repairs must be able to preserve the remaining label content.
    expect(result.expectedIngredients).toContain("Eggs");
    expect(result.expectedStorageInstruction).toContain("KEEP FROZEN");
  });

  it("treats the number visibly written on the label as the truth over stale descr alt-text", async () => {
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

    // The label's visible number is (01)10627146285572(15)250923(10)72722 —
    // the same values the artwork encodes — while the drawing's descr
    // alt-text claims GTIN 10759242722054 and the LOT/BB text lines say
    // 26827 / 2027-02-28. The written number must win everywhere.
    expect(result.expectedGtin).toBe("10627146285572");
    expect(result.scannedGtin).toBe("10627146285572");
    expect(result.expectedLotCode).toBe("72722");
    expect(result.expectedBestBefore).toBe("2025-09-23");
    expect(result.expectedBarcodeText).toBe("(01)10627146285572(15)250923(10)72722");
    expect(result.status).toBe("attention");
    const fields = result.mismatches.map((m) => m.field);
    expect(fields).not.toContain("GTIN / Barcode Number");
    // The artwork encodes only the bare GTIN, so the number's (15)/(10) are
    // missing from the barcode...
    expect(fields).toContain("Best Before Date");
    expect(fields).toContain("Lot Code");
    // ...and the LOT/BB text lines also disagree with the written number.
    expect(fields).toContain("Best Before Text");
    expect(fields).toContain("Lot Code Text");
    expect(result.barcodeMediaFile).toBe("word/media/image2.png");
    expect(result.scannedBarcodeNumber).toBeTruthy();
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
