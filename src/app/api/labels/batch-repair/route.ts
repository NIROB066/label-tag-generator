import { NextResponse } from "next/server";
import JSZip from "jszip";
import { generateGs1BarcodePng } from "@/domain/barcode";
import { buildGs1Payload } from "@/domain/gs1";
import { scanDocxLabel } from "@/domain/barcode-scanner";
import { generateLabelDocx } from "@/domain/docx-writer";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files");

    if (!files.length) {
      return NextResponse.json({ error: "No files uploaded to repair." }, { status: 400 });
    }

    const zipOut = new JSZip();
    let repairedCount = 0;

    for (const file of files) {
      if (!(file instanceof File)) continue;

      const buffer = Buffer.from(await file.arrayBuffer());
      const scan = await scanDocxLabel(buffer, file.name);

      if (!scan.expectedGtin) continue;

      // Generate a fresh label from the Lava Cake template using expected data from the scan.
      // This is the same pipeline as Create Label — guarantees correct layout every time.
      const input = {
        productName: scan.productName || "Food Label",
        itemNumber: scan.itemNumber || "",
        gtin: scan.expectedGtin,
        lotCode: scan.expectedLotCode || "00000",
        bestBefore: scan.expectedBestBefore || "2026-12-31",
        ingredients: "",
        storageInstruction: "KEEP FROZEN",
      };

      const payload = buildGs1Payload(input);
      const barcodePng = await generateGs1BarcodePng(payload);
      const repairedDocx = await generateLabelDocx(input, barcodePng);

      const baseName = file.name.replace(/\.docx$/i, "");
      zipOut.file(`${baseName}-repaired.docx`, repairedDocx);
      repairedCount++;
    }

    if (repairedCount === 0) {
      return NextResponse.json(
        { error: "None of the files could be repaired. Ensure they have expected GTINs." },
        { status: 400 },
      );
    }

    const zipBuffer = await zipOut.generateAsync({ type: "nodebuffer" });

    return new NextResponse(new Uint8Array(zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="repaired-labels.zip"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Batch repair failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
