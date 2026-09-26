import { readFile } from "node:fs/promises";
import { DEFAULT_APP_INFO, dataWorkbookPath, readDataWorkbook } from "@/domain/app-info";

export const runtime = "nodejs";

/**
 * Serves the app metadata stored in data.xlsx (version, release update,
 * address) for the version badge and the Create-mode preview. Falls back to
 * the compiled-in defaults when the workbook is missing or unreadable.
 */
export async function GET() {
  let info = DEFAULT_APP_INFO;
  try {
    info = await readDataWorkbook(new Uint8Array(await readFile(dataWorkbookPath())));
  } catch {
    // data.xlsx missing or invalid — defaults keep the UI working.
  }

  return Response.json(
    { ...info, logoUrl: "/api/app-info/logo" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
