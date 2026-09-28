import { NextResponse } from "next/server";

import { renderLabelPreviewPdf } from "@/domain/label-preview-pdf";

export const runtime = "nodejs";

/**
 * Renders the Create-mode label preview as a real 4"x6" PDF from the same
 * data, barcode generator, and auto-fit rules the DOCX writer uses.
 */
export async function POST(request: Request) {
  try {
    const input = (await request.json()) as Parameters<typeof renderLabelPreviewPdf>[0];
    const pdf = await renderLabelPreviewPdf(input);

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Label preview failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
