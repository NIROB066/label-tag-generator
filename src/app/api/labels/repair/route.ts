import { NextResponse } from "next/server";
import { generateGs1BarcodePng } from "@/domain/barcode";
import { buildGs1Payload } from "@/domain/gs1";
import { LabelInput } from "@/domain/label-schema";
import { repairDocxBarcode } from "@/domain/docx-repair";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Upload a DOCX file to repair." }, { status: 400 });
    }

    const input: LabelInput = {
      productName: String(formData.get("productName") ?? "Label"),
      itemNumber: String(formData.get("itemNumber") ?? ""),
      gtin: String(formData.get("gtin") ?? ""),
      lotCode: String(formData.get("lotCode") ?? ""),
      bestBefore: String(formData.get("bestBefore") ?? ""),
      ingredients: String(formData.get("ingredients") ?? ""),
      storageInstruction: String(formData.get("storageInstruction") ?? ""),
    };

    const barcodeMediaFile = formData.get("barcodeMediaFile") ? String(formData.get("barcodeMediaFile")) : undefined;
    const widthEmu = formData.get("widthEmu") ? Number(formData.get("widthEmu")) : undefined;
    const heightEmu = formData.get("heightEmu") ? Number(formData.get("heightEmu")) : undefined;

    const payload = buildGs1Payload(input);
    const barcodePng = await generateGs1BarcodePng(payload);

    const repaired = await repairDocxBarcode(
      Buffer.from(await file.arrayBuffer()),
      {
        barcodeMediaFile,
        newBarcodePng: barcodePng,
        widthEmu,
        heightEmu,
        authoritativeBarcodeText: payload.humanReadable,
      },
    );

    return new NextResponse(new Uint8Array(repaired), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${safeFilename(file.name.replace(/\.docx$/i, ""))}-repaired.docx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Label repair failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function safeFilename(value: string): string {
  return value.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "label";
}
