import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { scanDocxLabel } from "./barcode-scanner";

describe("scanDocxLabel", () => {
  it("scans and matches Lava Cake sample correctly", async () => {
    const file = await readFile(
      path.join(process.cwd(), "sample", "Lava Cake Label 6''x4''.docx"),
    );
    const result = await scanDocxLabel(file, "Lava Cake Label 6''x4''.docx");

    expect(result.scannedGtin).toBe("10627146285749");
    expect(result.expectedGtin).toBe("10627146285749");
    expect(result.status).toBe("ready");
    expect(result.barcodeMediaFile).toBe("word/media/image2.png");
    expect(result.barcodeImageBase64).toContain("data:image/png;base64,");
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
    expect(result.barcodeMediaFile).toBe("word/media/image2.png");
  });

  it("scans inline drawing barcode on Issue/Lava-Cake-3-Inch.docx", async () => {
    const file = await readFile(
      path.join(process.cwd(), "Issue", "Lava-Cake-3-Inch.docx"),
    );
    const result = await scanDocxLabel(file, "Lava-Cake-3-Inch.docx");

    expect(result.expectedGtin).toBe("10627146285749");
    expect(result.scannedGtin).toBe("10627146285749");
    expect(result.status).toBe("ready");
    expect(result.barcodeMediaFile).toBe(
      "word/media/image2.png",
    );
  });
});
