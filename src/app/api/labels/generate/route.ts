import { NextResponse } from "next/server";
import { generateGs1BarcodePng } from "@/domain/barcode";
import { buildGs1Payload } from "@/domain/gs1";
import { LabelInput } from "@/domain/label-schema";
import { generateLabelDocx } from "@/domain/docx-writer";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as LabelInput;
    const payload = buildGs1Payload(input);
    const barcode = await generateGs1BarcodePng(payload);
    const document = await generateLabelDocx(input, barcode);

    return new NextResponse(new Uint8Array(document), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${safeFilename(input.productName)}.docx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Label generation failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function safeFilename(value: string): string {
  const filename = value.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
  return filename || "generated-label";
}
