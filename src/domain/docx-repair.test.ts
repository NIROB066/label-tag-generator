import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { repairDocxBarcode } from "./docx-repair";
import { scanDocxLabel } from "./barcode-scanner";
import { generateGs1BarcodePng } from "./barcode";
import { buildGs1Payload } from "./gs1";

const raspberrySample = path.join(
  process.cwd(),
  "sample",
  "Raspberry cheesecake  Label (6''x4'').docx",
);

async function documentText(bytes: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")?.async("text");
  if (!xml) throw new Error("missing document.xml");
  return xml.replace(/<[^>]+>/g, "");
}

describe("repairDocxBarcode", () => {
  it("repairs mismatched Raspberry cheesecake barcode and verifies scan matches", async () => {
    const originalFile = await readFile(raspberrySample);

    // Initial scan detects mismatch: the artwork encodes an old date/lot
    // while the written GTIN comes from the number printed on the label.
    const initialScan = await scanDocxLabel(originalFile);
    expect(initialScan.status).toBe("attention");
    expect(initialScan.expectedGtin).toBe("10627146285572");
    expect(initialScan.scannedGtin).toBe("10627146285572");

    // Generate the correct barcode for expected data
    const correctPayload = buildGs1Payload({
      gtin: initialScan.expectedGtin,
      lotCode: initialScan.expectedLotCode || "26827",
      bestBefore: initialScan.expectedBestBefore || "2027-02-28",
    });
    const newBarcodePng = await generateGs1BarcodePng(correctPayload);

    // Repair the document
    const repairedDocx = await repairDocxBarcode(originalFile, {
      barcodeMediaFile: initialScan.barcodeMediaFile ?? undefined,
      newBarcodePng,
      authoritativeBarcodeText: correctPayload.humanReadable,
      lotCode: correctPayload.lotCode,
      bestBefore: initialScan.expectedBestBefore || "2027-02-28",
    });

    // Scan the repaired document
    const repairedScan = await scanDocxLabel(repairedDocx);
    expect(repairedScan.status).toBe("ready");
    expect(repairedScan.scannedGtin).toBe("10627146285572");
    expect(repairedScan.expectedGtin).toBe("10627146285572");
    expect(repairedScan.mismatches.length).toBe(0);
  });

  it("keeps title, ingredients, fonts, and barcode geometry untouched", async () => {
    const originalFile = await readFile(raspberrySample);
    const scan = await scanDocxLabel(originalFile);
    const payload = buildGs1Payload({
      gtin: scan.expectedGtin,
      lotCode: scan.expectedLotCode,
      bestBefore: scan.expectedBestBefore,
    });
    const repairedDocx = await repairDocxBarcode(originalFile, {
      barcodeMediaFile: scan.barcodeMediaFile ?? undefined,
      newBarcodePng: await generateGs1BarcodePng(payload),
      authoritativeBarcodeText: payload.humanReadable,
      lotCode: payload.lotCode,
      bestBefore: scan.expectedBestBefore,
    });

    const before = await documentText(originalFile);
    const after = await documentText(repairedDocx);

    // Title and ingredients are preserved exactly as authored (no run-split
    // spaces, no duplicated "Ingredients:" prefix, no template leftovers).
    expect(after).toContain("Raspberry");
    expect(after).toContain("Cheesecake Cups");
    expect(after).not.toContain("Ingredients: Ingredients");
    expect(after).not.toContain("Lava Cake");

    const originalIngredients = before.match(/Ingredients:[^I]*/)?.[0] ?? "";
    expect(after).toContain(originalIngredients.trim().slice(0, 40));

    // LOT / BEST BEFORE text is synced to the written barcode number's values
    // (72722 / 2025-09-23) with a space after the colon.
    expect(after).toContain("LOT CODE: 72722");
    expect(after).toContain("BEST BEFORE: 2025/09/23");

    // Barcode drawing geometry is preserved at the detected size and position.
    const geometry = await drawingGeometry(repairedDocx, scan.barcodeMediaFile ?? "");
    expect(geometry).toEqual({ cx: scan.widthEmu, cy: scan.heightEmu });
  });

  it("blanks the stray 'v' paragraph without deleting it, keeping the barcode baseline", async () => {
    const originalFile = await readFile(raspberrySample);
    const scan = await scanDocxLabel(originalFile);
    const payload = buildGs1Payload({
      gtin: scan.expectedGtin,
      lotCode: scan.expectedLotCode,
      bestBefore: scan.expectedBestBefore,
    });
    const repairedDocx = await repairDocxBarcode(originalFile, {
      barcodeMediaFile: scan.barcodeMediaFile ?? undefined,
      newBarcodePng: await generateGs1BarcodePng(payload),
      authoritativeBarcodeText: payload.humanReadable,
      lotCode: payload.lotCode,
      bestBefore: scan.expectedBestBefore,
    });

    const beforeZip = await JSZip.loadAsync(originalFile);
    const afterZip = await JSZip.loadAsync(repairedDocx);
    const beforeXml = await beforeZip.file("word/document.xml")!.async("string");
    const afterXml = await afterZip.file("word/document.xml")!.async("string");

    // The stray glyph is gone ...
    expect(afterXml).not.to.match(/<w:t>[vV]<\/w:t>/);
    // ... but the paragraph that carried it (and anchors the barcode stack's
    // baseline) still exists, so paragraph-relative positions are unchanged.
    expect((afterXml.match(/<w:p[ >]/g) ?? []).length).toBe(
      (beforeXml.match(/<w:p[ >]/g) ?? []).length,
    );
    expect(afterXml).toContain('w14:paraId="66B0F1C1"');
  });

  it("corrects wrong LOT CODE and BEST BEFORE text in place", async () => {
    const originalFile = await readFile(raspberrySample);
    const scan = await scanDocxLabel(originalFile);
    const payload = buildGs1Payload({
      gtin: scan.expectedGtin,
      lotCode: "99001",
      bestBefore: "2031-12-31",
    });
    const repairedDocx = await repairDocxBarcode(originalFile, {
      barcodeMediaFile: scan.barcodeMediaFile ?? undefined,
      newBarcodePng: await generateGs1BarcodePng(payload),
      authoritativeBarcodeText: payload.humanReadable,
      lotCode: "99001",
      bestBefore: "2031-12-31",
    });

    const after = await documentText(repairedDocx);
    expect(after).toContain("LOT CODE: 99001");
    expect(after).toContain("BEST BEFORE: 2031/12/31");
    expect(after).not.toContain("26827");
    expect(after).not.toContain("2027/02/28");

    const repairedScan = await scanDocxLabel(repairedDocx);
    expect(repairedScan.status).toBe("ready");
    expect(repairedScan.expectedLotCode).toBe("99001");
    expect(repairedScan.expectedBestBefore).toBe("2031-12-31");
  });
  it("rewrites the human-readable number when Word split it across runs, leaving no extra digits", async () => {
    const payload = buildGs1Payload({
      gtin: "10627146285572",
      lotCode: "26827",
      bestBefore: "2027-02-28",
    });
    const png = await generateGs1BarcodePng(payload);

    // Simulates a user edit in Word: the number below the barcode is now
    // fragmented across several runs, e.g. the date was updated but the old
    // lot tail lives in its own run.
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t>LOT CODE: 72722 BEST BEFORE: 2025/09/23</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>(01)10627146285572(15)270228(10)</w:t></w:r>
      <w:r><w:t>72722</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;

    const zip = new JSZip();
    zip.file("word/document.xml", documentXml);
    zip.file("word/media/image1.png", png);
    const docx = await zip.generateAsync({ type: "nodebuffer" });

    const repaired = await repairDocxBarcode(docx, {
      barcodeMediaFile: "word/media/image1.png",
      newBarcodePng: png,
      authoritativeBarcodeText: payload.humanReadable,
      lotCode: payload.lotCode,
      bestBefore: "2027-02-28",
    });

    const after = await documentText(repaired);
    expect(after).toContain(payload.humanReadable);
    expect(after).toContain("LOT CODE: 26827");
    expect(after).toContain("BEST BEFORE: 2027/02/28");
    // The stale fragment from the edited run must be gone, not appended.
    expect(after).not.toContain(`${payload.humanReadable}72722`);
    expect(after).not.toContain("(10)2682772722");
  });
});

async function drawingGeometry(
  bytes: Buffer,
  mediaPath: string,
): Promise<{ cx: number; cy: number } | null> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")?.async("text");
  const rels = await zip.file("word/_rels/document.xml.rels")?.async("text");
  if (!xml || !rels) return null;

  const relMatch = rels.match(new RegExp(`Id="([^"]+)"[^>]+Target="[^"]*${mediaPath.split("/").pop()}`));
  if (!relMatch) return null;

  const drawing = xml.match(
    new RegExp(`<(?:wp:inline|wp:anchor)[\\s\\S]*?r:embed="${relMatch[1]}"[\\s\\S]*?<\\/wp:anchor>`),
  );
  if (!drawing) return null;

  const extent = drawing[0].match(/<wp:extent\s+cx="(\d+)"\s+cy="(\d+)"/);
  return extent ? { cx: Number(extent[1]), cy: Number(extent[2]) } : null;
}
