import { NextResponse } from "next/server";
import { scanDocxLabel } from "@/domain/barcode-scanner";
import { LabelScanResult } from "@/domain/label-schema";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files");

    if (!files.length) {
      // Check single "file" parameter as fallback
      const single = formData.get("file");
      if (single instanceof File) {
        files.push(single);
      }
    }

    if (!files.length) {
      return NextResponse.json(
        { error: "No DOCX files uploaded." },
        { status: 400 },
      );
    }

    const results: LabelScanResult[] = [];

    for (const file of files) {
      if (!(file instanceof File)) continue;

      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const scan = await scanDocxLabel(buffer, file.name);
        results.push(scan);
      } catch (err) {
        results.push({
          filename: file.name,
          productName: "Unreadable file",
          itemNumber: "",
          expectedGtin: "",
          expectedLotCode: "",
          expectedBestBefore: "",
          expectedBarcodeText: "",
          scannedRaw: null,
          scannedGtin: null,
          scannedLotCode: null,
          scannedBestBefore: null,
          barcodeMediaFile: null,
          barcodeImageBase64: null,
          status: "error",
          detail: err instanceof Error ? err.message : "Failed to scan DOCX",
          mismatches: [
            {
              field: "File",
              expected: "Valid DOCX",
              actual: "Error",
              message: err instanceof Error ? err.message : "DOCX inspection failed",
            },
          ],
        });
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scan request failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
