// Regenerates the root data.xlsx workbook that feeds /api/app-info.
// Run with: node scripts/generate-data-xlsx.mjs
//
// Built with exceljs so the embedded logo picture survives being opened,
// edited, and re-saved in Excel (a hand-rolled OPC/DrawingML package was
// silently repaired by Excel and the image was dropped on save).
//
// Keep the values below in sync with DEFAULT_APP_INFO in src/domain/app-info.ts.
import { readFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";

const VERSION = "1.2.0";
const RELEASE_UPDATE = [
  `Version ${VERSION}`,
  "- Drag & drop: drop .docx labels or .zip archives anywhere in Check & fix to scan them.",
  "- Dark mode: follows your system theme by default; switch anytime with the sun/moon button in the top bar.",
].join("\n");
const ADDRESS = "Gastronomique pastry INC, 7621 vantage way, Delta, BC V4G 1A6";

// Source logo is 528x190 px; drawn at 160 px wide to keep the aspect ratio.
const LOGO_WIDTH_PX = 160;
const LOGO_HEIGHT_PX = 58;

const TEMPLATE_PATH = path.join(process.cwd(), "sample", "Lava Cake Label 6''x4''.docx");
const OUTPUT_PATH = path.join(process.cwd(), "data.xlsx");

const template = await readFile(TEMPLATE_PATH);
const JSZip = (await import("jszip")).default;
const templateZip = await JSZip.loadAsync(template, { checkCRC32: true });
const logoEntry = templateZip.file("word/media/image1.jpeg");
if (!logoEntry) {
  throw new Error("Template logo (word/media/image1.jpeg) not found in the sample DOCX.");
}
const logoBytes = await logoEntry.async("nodebuffer");

const workbook = new ExcelJS.Workbook();
workbook.creator = "Label Tag Studio";

const sheet = workbook.addWorksheet("Data");
sheet.columns = [
  { header: "Name", key: "name", width: 28 },
  { header: "Value", key: "value", width: 62 },
];
sheet.getRow(1).font = { bold: true };

sheet.addRow(["Version", VERSION]);

const notesRow = sheet.addRow(["Version-Release-Update", RELEASE_UPDATE]);
notesRow.getCell(2).alignment = { wrapText: true, vertical: "top" };
notesRow.height = 62;

const logoRow = sheet.addRow(["Logo", "logo-image (see picture)"]);
logoRow.getCell(2).alignment = { wrapText: true, vertical: "top" };
logoRow.height = 50;

const addressRow = sheet.addRow(["Address", ADDRESS]);
addressRow.getCell(2).alignment = { wrapText: true, vertical: "top" };

// Anchor the logo picture on the Logo row's Value cell (B4: col 1, row 3).
const imageId = workbook.addImage({ buffer: logoBytes, extension: "jpeg" });
sheet.addImage(imageId, {
  tl: { col: 1.05, row: 3.05 },
  ext: { width: LOGO_WIDTH_PX, height: LOGO_HEIGHT_PX },
  editAs: "oneCell",
});

await workbook.xlsx.writeFile(OUTPUT_PATH);
console.log(`Wrote ${OUTPUT_PATH} — Version ${VERSION}, logo ${logoBytes.length} bytes.`);
