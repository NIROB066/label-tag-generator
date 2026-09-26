// Regenerates the root data.xlsx workbook that feeds /api/app-info.
// Run with: node scripts/generate-data-xlsx.mjs
//
// Keep the values below in sync with DEFAULT_APP_INFO in src/domain/app-info.ts.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

const VERSION = "1.1.0";
const RELEASE_UPDATE = [
  `Version ${VERSION}`,
  "- Drag & drop: drop .docx labels or .zip archives anywhere in Check & fix to scan them.",
  "- Glowing version badge in the top-right corner; click it to read the release update.",
  "- App data (version, release notes, logo, address) now lives in data.xlsx.",
].join("\n");
const ADDRESS = "Gastronomique pastry INC, 7621 vantage way, Delta, BC V4G 1A6";

// Logo drawing size in EMU (1 px = 9525 EMU). Source logo is 528x190 px,
// drawn at 160 px wide to keep the 528:190 aspect ratio.
const LOGO_WIDTH_EMU = 1524000;
const LOGO_HEIGHT_EMU = 548640;

const TEMPLATE_PATH = path.join(process.cwd(), "sample", "Lava Cake Label 6''x4''.docx");
const OUTPUT_PATH = path.join(process.cwd(), "data.xlsx");

function esc(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("\n", "&#10;");
}

function cell(ref, text, style) {
  const s = style ? ` s="${style}"` : "";
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
}

const sheetRows = [
  // Row 1: header (bold)
  `<row r="1">${cell("A1", "Name", 1)}${cell("B1", "Value", 1)}</row>`,
  // Row 2: Version
  `<row r="2">${cell("A2", "Version")}${cell("B2", VERSION)}</row>`,
  // Row 3: Version-Release-Update (wrapped text)
  `<row r="3" ht="78" customHeight="1">${cell("A3", "Version-Release-Update")}${cell("B3", RELEASE_UPDATE, 2)}</row>`,
  // Row 4: Logo — the value is the embedded logo image anchored on cell B4
  `<row r="4" ht="48" customHeight="1">${cell("A4", "Logo")}${cell("B4", "logo-image (see picture)", 2)}</row>`,
  // Row 5: Address
  `<row r="5">${cell("A5", "Address")}${cell("B5", ADDRESS, 2)}</row>`,
].join("");

const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:B5"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>
    <col min="1" max="1" width="28" customWidth="1"/>
    <col min="2" max="2" width="62" customWidth="1"/>
  </cols>
  <sheetData>${sheetRows}</sheetData>
  <drawing r:id="rId1"/>
</worksheet>`;

const sheet1Rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`;

const drawing1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:oneCellAnchor>
    <xdr:from>
      <xdr:col>1</xdr:col><xdr:colOff>57150</xdr:colOff>
      <xdr:row>3</xdr:row><xdr:rowOff>57150</xdr:rowOff>
    </xdr:from>
    <xdr:ext cx="${LOGO_WIDTH_EMU}" cy="${LOGO_HEIGHT_EMU}"/>
    <xdr:pic>
      <xdr:nvPicPr>
        <xdr:cNvPr id="1" name="Logo"/>
        <xdr:cNvPicPr/>
      </xdr:nvPicPr>
      <xdr:blipFill>
        <a:blip r:embed="rId1"/>
        <a:stretch><a:fillRect/></a:stretch>
      </xdr:blipFill>
      <xdr:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="${LOGO_WIDTH_EMU}" cy="${LOGO_HEIGHT_EMU}"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      </xdr:spPr>
    </xdr:pic>
    <xdr:clientData/>
  </xdr:oneCellAnchor>
</xdr:wsDr>`;

const drawing1Rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.jpeg"/>
</Relationships>`;

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><color rgb="FF17211F"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF17211F"/><name val="Calibri"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Data" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
</Types>`;

const template = await readFile(TEMPLATE_PATH);
const templateZip = await JSZip.loadAsync(template, { checkCRC32: true });
const logo = templateZip.file("word/media/image1.jpeg");
if (!logo) {
  throw new Error("Template logo (word/media/image1.jpeg) not found in the sample DOCX.");
}
const logoBytes = await logo.async("uint8array");

const zip = new JSZip();
zip.file("[Content_Types].xml", contentTypes);
zip.file("_rels/.rels", rootRels);
zip.file("xl/workbook.xml", workbook);
zip.file("xl/_rels/workbook.xml.rels", workbookRels);
zip.file("xl/styles.xml", styles);
zip.file("xl/worksheets/sheet1.xml", sheet1);
zip.file("xl/worksheets/_rels/sheet1.xml.rels", sheet1Rels);
zip.file("xl/drawings/drawing1.xml", drawing1);
zip.file("xl/drawings/_rels/drawing1.xml.rels", drawing1Rels);
zip.file("xl/media/image1.jpeg", logoBytes);

const out = await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: { level: 9 },
});
await writeFile(OUTPUT_PATH, out);
console.log(`Wrote ${OUTPUT_PATH} (${out.length} bytes) — Version ${VERSION}, logo ${logoBytes.length} bytes.`);
