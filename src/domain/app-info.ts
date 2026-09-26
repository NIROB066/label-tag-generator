import path from "node:path";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

/**
 * App metadata sourced from the root data.xlsx workbook (Name / Value rows).
 * The workbook is the single source of truth for the version badge, the
 * release-update text, the brand logo, and the label address shown in Create
 * mode. DEFAULT_APP_INFO is the fallback used when the workbook is missing
 * or incomplete — keep it in sync with scripts/generate-data-xlsx.mjs.
 */
export type AppInfo = {
  version: string;
  releaseUpdate: string;
  address: string;
};

export const DEFAULT_APP_INFO: AppInfo = {
  version: "1.2.0",
  releaseUpdate: [
    "Version 1.2.0",
    "- Drag & drop: drop .docx labels or .zip archives anywhere in Check & fix to scan them.",
    "- Dark mode: follows your system theme by default; switch anytime with the sun/moon button in the top bar.",
  ].join("\n"),
  address: "Gastronomique pastry INC, 7621 vantage way, Delta, BC V4G 1A6",
};

export const DATA_WORKBOOK_FILE = "data.xlsx";

export function dataWorkbookPath(): string {
  return path.join(process.cwd(), DATA_WORKBOOK_FILE);
}

const parser = new XMLParser({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: false,
});

type XmlRecord = Record<string, unknown>;

function asArray<T>(node: T | T[] | undefined | null): T[] {
  if (node == null) return [];
  return Array.isArray(node) ? node : [node];
}

/** Decodes numeric character references (&#10;, &#xA;) left alone by the parser. */
function decodeNumericEntities(text: string): string {
  return text.replace(/&#(?:x([0-9a-fA-F]+)|(\d+));/g, (_, hex: string, dec: string) =>
    String.fromCodePoint(parseInt(hex ?? dec, hex ? 16 : 10)),
  );
}

/** Best-effort text extraction from a fast-xml-parser node (text, run, rich). */
function textOf(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return decodeNumericEntities(node);
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object") {
    const record = node as XmlRecord;
    if ("#text" in record) return textOf(record["#text"]);
  }
  return "";
}

/** Parses xl/sharedStrings.xml into the ordered list of shared strings. */
export function parseSharedStrings(sharedStringsXml: string): string[] {
  const document = parser.parse(sharedStringsXml) as XmlRecord;
  const sst = document.sst as XmlRecord | undefined;
  return asArray<XmlRecord>(sst?.si as XmlRecord | XmlRecord[] | undefined).map((si) => {
    if (si.t != null) return textOf(si.t);
    // Rich string: concatenated text of every run.
    return asArray<XmlRecord>(si.r as XmlRecord | XmlRecord[] | undefined)
      .map((run) => textOf(run.t))
      .join("");
  });
}

function cellValue(cell: XmlRecord, sharedStrings: string[]): string {
  const type = cell["@_t"];
  if (type === "inlineStr") {
    const inline = cell.is as XmlRecord | undefined;
    return inline ? textOf(inline.t) : "";
  }
  const raw = textOf(cell.v);
  if (type === "s") {
    return sharedStrings[Number(raw)] ?? "";
  }
  return raw;
}

export type DataRow = { name: string; value: string };

/**
 * Parses a worksheet's sheetData into Name (column A) / Value (column B)
 * rows. Supports inline strings and shared strings so workbooks re-saved by
 * Excel keep working.
 */
export function parseDataRows(sheetXml: string, sharedStrings: string[] = []): DataRow[] {
  const document = parser.parse(sheetXml) as XmlRecord;
  const worksheet = (document.worksheet as XmlRecord | undefined) ?? document;
  const sheetData = worksheet.sheetData as XmlRecord | undefined;
  const rows: DataRow[] = [];

  for (const row of asArray<XmlRecord>(sheetData?.row as XmlRecord | XmlRecord[] | undefined)) {
    let name = "";
    let value = "";
    for (const cell of asArray<XmlRecord>(row.c as XmlRecord | XmlRecord[] | undefined)) {
      const ref = String(cell["@_r"] ?? "");
      const column = ref.match(/^[A-Z]+/)?.[0];
      if (column === "A") name = cellValue(cell, sharedStrings).trim();
      else if (column === "B") value = cellValue(cell, sharedStrings).trim();
    }
    if (name) rows.push({ name, value });
  }

  return rows;
}

/** Maps Name/Value rows onto AppInfo; unknown or missing names fall back. */
export function toAppInfo(rows: DataRow[]): AppInfo {
  const info: AppInfo = { ...DEFAULT_APP_INFO };
  for (const row of rows) {
    const key = row.name.toLowerCase().replace(/[\s_-]+/g, "");
    if (key === "version") info.version = row.value || info.version;
    else if (key === "versionreleaseupdate") info.releaseUpdate = row.value || info.releaseUpdate;
    else if (key === "address") info.address = row.value || info.address;
    // "name"/"value"/"logo" header and picture rows carry no text value.
  }
  return info;
}

async function firstSheetXml(zip: JSZip): Promise<string | null> {
  const preferred = zip.file("xl/worksheets/sheet1.xml");
  const entry =
    preferred ??
    Object.values(zip.files).find(
      (candidate) => !candidate.dir && /^xl\/worksheets\/sheet\d+\.xml$/.test(candidate.name),
    );
  return entry ? entry.async("string") : null;
}

/** Reads AppInfo from the raw data.xlsx workbook bytes. */
export async function readDataWorkbook(input: Uint8Array): Promise<AppInfo> {
  const zip = await JSZip.loadAsync(input, { createFolders: false, checkCRC32: true });
  const sheetXml = await firstSheetXml(zip);
  if (!sheetXml) return { ...DEFAULT_APP_INFO };

  const sharedStringsEntry = zip.file("xl/sharedStrings.xml");
  const sharedStrings = sharedStringsEntry
    ? parseSharedStrings(await sharedStringsEntry.async("string"))
    : [];

  return toAppInfo(parseDataRows(sheetXml, sharedStrings));
}

/** Returns the first embedded workbook image (the Logo row picture), if any. */
export async function extractWorkbookLogo(input: Uint8Array): Promise<Uint8Array | null> {
  const zip = await JSZip.loadAsync(input, { createFolders: false });
  const media = Object.values(zip.files).find(
    (entry) => !entry.dir && /^xl\/media\/.+\.(png|jpe?g|gif|bmp|webp)$/i.test(entry.name),
  );
  return media ? new Uint8Array(await media.async("uint8array")) : null;
}
