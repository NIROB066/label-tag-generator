import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: false,
});

const MAX_UNCOMPRESSED_BYTES = 25 * 1024 * 1024;

export type PageGeometry = {
  widthTwips: number;
  heightTwips: number;
  marginsTwips: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
};

export type TextBoxInspection = {
  name: string;
  text: string;
  widthEmu?: number;
  heightEmu?: number;
};

export type ImageInspection = {
  relationshipId: string;
  target: string;
  mediaPath: string;
  contentType: string;
  widthEmu?: number;
  heightEmu?: number;
  drawingName?: string;
};

export type DocxInspection = {
  page: PageGeometry;
  textBoxes: TextBoxInspection[];
  images: ImageInspection[];
  documentText: string;
};

type XmlRecord = Record<string, unknown>;

export async function inspectDocx(input: Uint8Array): Promise<DocxInspection> {
  const zip = await JSZip.loadAsync(input, {
    createFolders: false,
    checkCRC32: true,
  });

  const entries = Object.values(zip.files);
  const uncompressedBytes = entries.reduce(
      (total, entry) =>
        total +
        ((entry as JSZipEntryWithMetadata)._data?.uncompressedSize ?? 0),
    0,
  );

  if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
    throw new Error("DOCX package exceeds the decompression safety limit.");
  }
type JSZipEntryWithMetadata = JSZip.JSZipObject & {
  _data?: { uncompressedSize?: number };
};

  const documentXml = await readRequiredEntry(zip, "word/document.xml");
  const relationshipsXml = await readRequiredEntry(
    zip,
    "word/_rels/document.xml.rels",
  );
  const contentTypesXml = await readRequiredEntry(zip, "[Content_Types].xml");
  const document = parser.parse(documentXml) as XmlRecord;
  const relationships = parser.parse(relationshipsXml) as XmlRecord;
  const contentTypes = parser.parse(contentTypesXml) as XmlRecord;

  const documentRoot = getRecord(document, "w:document");
  const body = getRecord(documentRoot, "w:body");
  const section = getRecord(body, "w:sectPr");
  const pageSize = getRecord(section, "w:pgSz");
  const pageMargins = getRecord(section, "w:pgMar");

  const page = {
    widthTwips: requiredNumber(pageSize, "@_w:w"),
    heightTwips: requiredNumber(pageSize, "@_w:h"),
    marginsTwips: {
      top: requiredNumber(pageMargins, "@_w:top"),
      right: requiredNumber(pageMargins, "@_w:right"),
      bottom: requiredNumber(pageMargins, "@_w:bottom"),
      left: requiredNumber(pageMargins, "@_w:left"),
    },
  };

  const textBoxes = collectTextBoxes(documentRoot);
  const relationshipMap = buildRelationshipMap(relationships);
  const contentTypeMap = buildContentTypeMap(contentTypes);
  const images = collectImages(documentRoot, relationshipMap, contentTypeMap);

  return {
    page,
    textBoxes,
    images,
    documentText: collectText(documentRoot).replace(/\s+/g, " ").trim(),
  };
}

async function readRequiredEntry(zip: JSZip, path: string): Promise<string> {
  const entry = zip.file(path);
  if (!entry) {
    throw new Error(`DOCX package is missing ${path}.`);
  }

  return entry.async("text");
}

function collectTextBoxes(root: XmlRecord): TextBoxInspection[] {
  const textBoxes: TextBoxInspection[] = [];

  walk(root, (node) => {
    const docPr = getRecord(node, "wp:docPr");
    const textBoxContent = getRecord(node, "w:txbxContent");

    if (!docPr || !textBoxContent) {
      return;
    }

    const extent = getRecord(node, "wp:extent");
    textBoxes.push({
      name: String(docPr["@_name"] ?? "Unnamed text box"),
      text: collectText(textBoxContent).replace(/\s+/g, " ").trim(),
      widthEmu: optionalNumber(extent, "@_cx"),
      heightEmu: optionalNumber(extent, "@_cy"),
    });
  });

  return textBoxes;
}

function collectImages(
  root: XmlRecord,
  relationships: Map<string, string>,
  contentTypes: Map<string, string>,
): ImageInspection[] {
  const images: ImageInspection[] = [];

  walk(root, (node) => {
    const blip = getRecord(node, "a:blip");
    const relationshipId = blip?.["@_r:embed"];

    if (typeof relationshipId !== "string") {
      return;
    }

    const target = relationships.get(relationshipId);
    if (!target) {
      return;
    }

    const extent = getRecord(node, "wp:extent");
    const docPr = getRecord(node, "wp:docPr");
    const mediaPath = target.startsWith("word/") ? target : `word/${target}`;
    const extension = mediaPath.split(".").pop()?.toLowerCase() ?? "";

    images.push({
      relationshipId,
      target,
      mediaPath,
      contentType: contentTypes.get(extension) ?? "application/octet-stream",
      widthEmu: optionalNumber(extent, "@_cx"),
      heightEmu: optionalNumber(extent, "@_cy"),
      drawingName:
        typeof docPr?.["@_name"] === "string"
          ? docPr["@_name"]
          : undefined,
    });
  });

  return images;
}

function buildRelationshipMap(root: XmlRecord): Map<string, string> {
  const relationships = asArray(getRecord(root, "Relationships")?.Relationship);
  return new Map(
    relationships.flatMap((relationship) => {
      const id = relationship["@_Id"];
      const target = relationship["@_Target"];
      return typeof id === "string" && typeof target === "string"
        ? [[id, target]]
        : [];
    }),
  );
}

function buildContentTypeMap(root: XmlRecord): Map<string, string> {
  const defaults = asArray(getRecord(root, "Types")?.Default);
  return new Map(
    defaults.flatMap((entry) => {
      const extension = entry["@_Extension"];
      const contentType = entry["@_ContentType"];
      return typeof extension === "string" && typeof contentType === "string"
        ? [[extension.toLowerCase(), contentType]]
        : [];
    }),
  );
}

function collectText(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(collectText).join("");
  }

  if (!node || typeof node !== "object") {
    return "";
  }

  return Object.entries(node)
    .filter(([key]) => !key.startsWith("@_"))
    .map(([, value]) => collectText(value))
    .join("");
}

function walk(node: unknown, visitor: (node: XmlRecord) => void): void {
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visitor));
    return;
  }

  if (!node || typeof node !== "object") {
    return;
  }

  visitor(node as XmlRecord);
  Object.entries(node).forEach(([key, value]) => {
    if (!key.startsWith("@_")) {
      walk(value, visitor);
    }
  });
}

function getRecord(node: unknown, key: string): XmlRecord {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return {};
  }

  const value = (node as XmlRecord)[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as XmlRecord;
}

function asArray(value: unknown): XmlRecord[] {
  if (Array.isArray(value)) {
    return value.filter(
      (entry): entry is XmlRecord =>
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
    );
  }

  return value && typeof value === "object" ? [value as XmlRecord] : [];
}

function requiredNumber(node: XmlRecord, key: string): number {
  const value = optionalNumber(node, key);
  if (value === undefined) {
    throw new Error(`DOCX package is missing numeric attribute ${key}.`);
  }

  return value;
}

function optionalNumber(node: XmlRecord, key: string): number | undefined {
  const value = node[key];
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
