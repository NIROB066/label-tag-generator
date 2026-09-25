import { NextResponse } from "next/server";
import { generateGs1BarcodePng } from "@/domain/barcode";
import { buildGs1Payload } from "@/domain/gs1";
import { scanDocxLabel } from "@/domain/barcode-scanner";
import { repairDocxBarcode } from "@/domain/docx-repair";

export const runtime = "nodejs";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function positiveInt(formData: FormData, name: string): number | undefined {
  const value = Number(field(formData, name));
  return Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Upload a DOCX file to repair." }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const scan = await scanDocxLabel(bytes, file.name);

    // Authoritative values: explicit form overrides win, otherwise the values
    // scanned from the document (the written number is the truth).
    const gtin = field(formData, "gtin") || scan.expectedGtin;
    const bestBefore = field(formData, "bestBefore") || scan.expectedBestBefore;
    const lotCode = field(formData, "lotCode") || scan.expectedLotCode;

    if (!gtin) {
      return NextResponse.json(
        { error: "No GTIN found on the label to rebuild the barcode from." },
        { status: 400 },
      );
    }
    if (!bestBefore || !lotCode) {
      return NextResponse.json(
        { error: "Label is missing a best-before date or lot code to encode." },
        { status: 400 },
      );
    }

    const payload = buildGs1Payload({ gtin, bestBefore, lotCode });
    const barcodePng = await generateGs1BarcodePng(payload, { scale: 6, height: 20 });

    // Surgical in-place patch: the barcode keeps its detected size and
    // position unless explicit dimensions were supplied. Title, ingredients,
    // fonts, and all other label content are left untouched.
    const repairedDocx = await repairDocxBarcode(bytes, {
      newBarcodePng: barcodePng,
      barcodeMediaFile: scan.barcodeMediaFile ?? undefined,
      authoritativeBarcodeText: payload.humanReadable,
      lotCode: payload.lotCode,
      bestBefore,
      widthEmu: positiveInt(formData, "widthEmu"),
      heightEmu: positiveInt(formData, "heightEmu"),
    });

    return new NextResponse(new Uint8Array(repairedDocx), {
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
