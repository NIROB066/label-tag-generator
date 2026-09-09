import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

export const runtime = "nodejs";

export async function GET() {
  const templatePath = path.join(
    process.cwd(),
    "sample",
    "Lava Cake Label 6''x4''.docx",
  );
  const template = await readFile(templatePath);
  const zip = await JSZip.loadAsync(template, { checkCRC32: true });
  const logo = zip.file("word/media/image1.jpeg");

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
