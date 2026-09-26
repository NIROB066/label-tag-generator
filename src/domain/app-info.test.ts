import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  DEFAULT_APP_INFO,
  dataWorkbookPath,
  extractWorkbookLogo,
  parseDataRows,
  parseSharedStrings,
  readDataWorkbook,
  toAppInfo,
} from "./app-info";

const inlineSheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr" s="1"><is><t>Name</t></is></c><c r="B1" t="inlineStr" s="1"><is><t>Value</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Version</t></is></c><c r="B2" t="inlineStr"><is><t>2.0.0</t></is></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>Version-Release-Update</t></is></c><c r="B3" t="inlineStr"><is><t>Line one&#10;Line two</t></is></c></row>
    <row r="4"><c r="A4" t="inlineStr"><is><t>Address</t></is></c><c r="B4" t="inlineStr"><is><t>Test Bakery, 1 Sample Rd</t></is></c></row>
  </sheetData>
</worksheet>`;

const sharedSheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
    <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>
  </sheetData>
</worksheet>`;

const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <si><t>Name</t></si>
  <si><t>Value</t></si>
  <si><t>Address</t></si>
  <si><r><t>Rich </t></r><r><t>runs</t></r></si>
</sst>`;

async function buildWorkbook(parts: Record<string, string>, media?: { name: string; bytes: Uint8Array }) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(parts)) zip.file(name, content);
  if (media) zip.file(media.name, media.bytes);
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

describe("parseDataRows", () => {
  it("reads Name/Value rows written with inline strings", () => {
    const rows = parseDataRows(inlineSheet);
    expect(rows).toEqual([
      { name: "Name", value: "Value" },
      { name: "Version", value: "2.0.0" },
      { name: "Version-Release-Update", value: "Line one\nLine two" },
      { name: "Address", value: "Test Bakery, 1 Sample Rd" },
    ]);
  });

  it("resolves shared-string cells and joins rich text runs", () => {
    const strings = parseSharedStrings(sharedStringsXml);
    expect(strings).toEqual(["Name", "Value", "Address", "Rich runs"]);
    const rows = parseDataRows(sharedSheet, strings);
    expect(rows).toEqual([
      { name: "Name", value: "Value" },
      { name: "Address", value: "Rich runs" },
    ]);
  });
});

describe("toAppInfo", () => {
  it("maps known names and ignores the header row", () => {
    const info = toAppInfo(parseDataRows(inlineSheet));
    expect(info).toEqual({
      version: "2.0.0",
      releaseUpdate: "Line one\nLine two",
      address: "Test Bakery, 1 Sample Rd",
    });
  });

  it("falls back to defaults for missing rows and blank values", () => {
    expect(toAppInfo([])).toEqual(DEFAULT_APP_INFO);
    expect(toAppInfo([{ name: "Version", value: "" }]).version).toBe(DEFAULT_APP_INFO.version);
  });
});

describe("readDataWorkbook", () => {
  it("reads a workbook with inline strings", async () => {
    const bytes = await buildWorkbook({ "xl/worksheets/sheet1.xml": inlineSheet });
    await expect(readDataWorkbook(bytes)).resolves.toEqual({
      version: "2.0.0",
      releaseUpdate: "Line one\nLine two",
      address: "Test Bakery, 1 Sample Rd",
    });
  });

  it("falls back to defaults when no worksheet exists", async () => {
    const bytes = await buildWorkbook({ "xl/workbook.xml": "<workbook/>" });
    await expect(readDataWorkbook(bytes)).resolves.toEqual(DEFAULT_APP_INFO);
  });

  it("rejects non-xlsx bytes", async () => {
    await expect(readDataWorkbook(new TextEncoder().encode("not a zip"))).rejects.toThrow();
  });

  it("reads the committed data.xlsx fixture at the project root", async () => {
    const bytes = new Uint8Array(await readFile(path.join(process.cwd(), "data.xlsx")));
    const info = await readDataWorkbook(bytes);
    expect(info.version).toBe(DEFAULT_APP_INFO.version);
    expect(info.releaseUpdate).toContain("Drag & drop");
    expect(info.address).toBe(DEFAULT_APP_INFO.address);
    expect(dataWorkbookPath()).toBe(path.join(process.cwd(), "data.xlsx"));
  });
});

describe("extractWorkbookLogo", () => {
  it("returns embedded media images and null when absent", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const withLogo = await buildWorkbook(
      { "xl/worksheets/sheet1.xml": inlineSheet },
      { name: "xl/media/image1.jpeg", bytes: jpeg },
    );
    await expect(extractWorkbookLogo(withLogo)).resolves.toEqual(jpeg);

    const withoutLogo = await buildWorkbook({ "xl/worksheets/sheet1.xml": inlineSheet });
    await expect(extractWorkbookLogo(withoutLogo)).resolves.toBeNull();
  });

  it("extracts the logo image from the committed data.xlsx fixture", async () => {
    const bytes = new Uint8Array(await readFile(path.join(process.cwd(), "data.xlsx")));
    const logo = await extractWorkbookLogo(bytes);
    expect(logo).not.toBeNull();
    expect(logo?.[0]).toBe(0xff);
    expect(logo?.[1]).toBe(0xd8);
    expect(logo?.length).toBeGreaterThan(1000);
  });
});
