import { NextResponse } from "next/server";
import { generateGs1BarcodePng } from "@/domain/barcode";
import { buildGs1Payload } from "@/domain/gs1";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as {
      gtin: string;
      bestBefore: string;
      lotCode: string;
    };
    const payload = buildGs1Payload(input);
    const barcode = await generateGs1BarcodePng(payload);

    return new NextResponse(new Uint8Array(barcode), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Barcode preview failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
