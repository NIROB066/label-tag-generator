import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { LABEL_TEMPLATE, labelTemplatePath } from "@/domain/label-template";

export const runtime = "nodejs";

export async function GET() {
  const template = await readFile(labelTemplatePath());
  const zip = await JSZip.loadAsync(template, { checkCRC32: true });
  const logo = zip.file(LABEL_TEMPLATE.logoMediaPath);

  if (!logo) {
    return new Response("Template logo not found.", { status: 404 });
  }

  return new Response(new Uint8Array(await logo.async("uint8array")), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
