import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { extractWorkbookLogo, dataWorkbookPath } from "@/domain/app-info";
import { LABEL_TEMPLATE, labelTemplatePath } from "@/domain/label-template";

export const runtime = "nodejs";

const LOGO_HEADERS = {
  "Content-Type": "image/jpeg",
  "Cache-Control": "public, max-age=3600",
};

/**
 * Serves the Logo picture embedded in data.xlsx; falls back to the label
 * template's own logo so the Create-mode preview always has artwork.
 */
export async function GET() {
  try {
    const workbookBytes = new Uint8Array(await readFile(dataWorkbookPath()));
    const logo = await extractWorkbookLogo(workbookBytes);
    if (logo) {
      return new Response(new Uint8Array(logo), { headers: LOGO_HEADERS });
    }
  } catch {
    // data.xlsx missing or has no embedded image — use the template logo.
  }

  try {
    const template = await readFile(labelTemplatePath());
    const zip = await JSZip.loadAsync(template, { checkCRC32: true });
    const templateLogo = zip.file(LABEL_TEMPLATE.logoMediaPath);
    if (templateLogo) {
      return new Response(new Uint8Array(await templateLogo.async("uint8array")), {
        headers: LOGO_HEADERS,
      });
    }
  } catch {
    // Template unreadable too — nothing sensible to serve.
  }

  return new Response("Logo not found.", { status: 404 });
}
