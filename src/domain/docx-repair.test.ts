import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repairDocxBarcode } from "./docx-repair";
import { scanDocxLabel } from "./barcode-scanner";
import { generateGs1BarcodePng } from "./barcode";
import { buildGs1Payload } from "./gs1";

describe("repairDocxBarcode", () => {
  it("repairs mismatched Raspberry cheesecake barcode and verifies scan matches", async () => {
    const originalFile = await readFile(
      path.join(
        process.cwd(),
        "sample",
        "Raspberry cheesecake  Label (6''x4'').docx",
      ),
    );

    // Initial scan detects mismatch
    const initialScan = await scanDocxLabel(originalFile);
    expect(initialScan.status).toBe("attention");
    expect(initialScan.expectedGtin).toBe("10759242722054");
    expect(initialScan.scannedGtin).toBe("10627146285572");

    // Generate the correct barcode for expected data
    const correctPayload = buildGs1Payload({
      productName: initialScan.productName,
      itemNumber: initialScan.itemNumber,
      gtin: initialScan.expectedGtin,
      lotCode: initialScan.expectedLotCode || "26827",
      bestBefore: initialScan.expectedBestBefore || "2027-02-28",
      ingredients: "Sample ingredients",
      storageInstruction: "KEEP FROZEN",
    });
    const newBarcodePng = await generateGs1BarcodePng(correctPayload);

    // Repair the document
    const repairedDocx = await repairDocxBarcode(originalFile, {
      barcodeMediaFile: initialScan.barcodeMediaFile ?? undefined,
      newBarcodePng,
      authoritativeBarcodeText: correctPayload.humanReadable,
    });

    // Scan the repaired document
    const repairedScan = await scanDocxLabel(repairedDocx);
    expect(repairedScan.status).toBe("ready");
    expect(repairedScan.scannedGtin).toBe("10759242722054");
    expect(repairedScan.expectedGtin).toBe("10759242722054");
    expect(repairedScan.mismatches.length).toBe(0);
  });

  it("repairs inline drawing barcode in Issue/Lava-Cake-3-Inch.docx without error", async () => {
    const originalFile = await readFile(
      path.join(process.cwd(), "Issue", "Lava-Cake-3-Inch.docx"),
    );

    const initialScan = await scanDocxLabel(originalFile);
    expect(initialScan.status).toBe("ready");

    // Generate a replacement barcode with matching lot and date
    const payload = buildGs1Payload({
      productName: initialScan.productName,
      itemNumber: initialScan.itemNumber,
      gtin: initialScan.expectedGtin,
      lotCode: initialScan.expectedLotCode,
      bestBefore: initialScan.expectedBestBefore,
      ingredients: "Eggs, sugar, wheat flour, margarine, dark chocolate.",
      storageInstruction: "KEEP FROZEN",
    });
    const newBarcodePng = await generateGs1BarcodePng(payload);

    const repairedDocx = await repairDocxBarcode(originalFile, {
      barcodeMediaFile: initialScan.barcodeMediaFile ?? undefined,
      newBarcodePng,
      authoritativeBarcodeText: payload.humanReadable,
    });

    const repairedScan = await scanDocxLabel(repairedDocx);
    expect(repairedScan.scannedGtin).toBe("10627146285749");
    expect(repairedScan.scannedLotCode).toBe(initialScan.expectedLotCode);
    expect(repairedScan.status).toBe("ready");
  });
});
