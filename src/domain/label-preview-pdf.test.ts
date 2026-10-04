import { inflateSync } from "node:zlib";
import { PDFArray, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { renderLabelPreviewPdf } from "@/domain/label-preview-pdf";
import { normalizeIngredientsSpacing } from "@/domain/label-typography";

function countEmbeddedImages(pdf: PDFDocument): number {
  return pdf.context
    .enumerateIndirectObjects()
    .filter(
      ([, obj]) =>
        obj instanceof PDFRawStream && obj.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"),
    )
    .length;
}

type DrawnText = { x: number; y: number; text: string };

/** Decodes the page's text-showing operators into positioned strings. */
function drawnTexts(pdf: PDFDocument): DrawnText[] {
  const contents = pdf.getPage(0).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
  const texts: DrawnText[] = [];
  for (const ref of streams) {
    const stream = pdf.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) continue;
    const decoded = inflateSync(Buffer.from(stream.contents)).toString("latin1");
    for (const [, xs, ys, hex] of decoded.matchAll(
      /1 0 0 1 ([\d.-]+) ([\d.-]+) Tm\s*<([0-9A-Fa-f]*)> Tj/g,
    )) {
      texts.push({ x: parseFloat(xs), y: parseFloat(ys), text: Buffer.from(hex, "hex").toString("latin1") });
    }
  }
  return texts;
}

/** Joins drawn texts into visual lines, top to bottom, within the ingredients box band. */
function ingredientsLines(pdf: PDFDocument): string[] {
  // The ingredients box spans yTop 166.7 to 166.7+158.5 (expanded) — no other
  // label element draws text inside that band.
  const band = drawnTexts(pdf).filter((t) => t.y > 106.8 && t.y < 265.3);
  const byBaseline = new Map<number, DrawnText[]>();
  for (const t of band) {
    const key = Math.round(t.y * 10) / 10;
    byBaseline.set(key, [...(byBaseline.get(key) ?? []), t]);
  }
  return [...byBaseline.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, parts]) => parts.sort((a, b) => a.x - b.x).map((part) => part.text).join(""));
}

const input = {
  productName: "Lava Cake 3 Inch",
  itemNumber: "GP2118",
  gtin: "10627146285749",
  lotCode: "72722",
  bestBefore: "2025-09-23",
  ingredients: "Eggs, sugar, wheat flour, margarine, dark chocolate.",
  storageInstruction: "KEEP FROZEN",
};

describe("label PDF preview", () => {
  it("renders a 4x6 PDF page for a complete label", async () => {
    const bytes = await renderLabelPreviewPdf(input);

    expect(Buffer.from(bytes.slice(0, 5)).toString("utf8")).toBe("%PDF-");

    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    const page = pdf.getPage(0);
    expect(Math.round(page.getWidth())).toBe(288);
    expect(Math.round(page.getHeight())).toBe(432);
    // Template logo + generated barcode PNG (plus its alpha SMask).
    expect(countEmbeddedImages(pdf)).toBeGreaterThanOrEqual(2);
  });

  it("still renders with incomplete data and long ingredients", async () => {
    const bytes = await renderLabelPreviewPdf({
      ...input,
      gtin: "",
      lotCode: "",
      bestBefore: "",
      ingredients: `Eggs, sugar, wheat flour, ${"x".repeat(600)}`,
    });

    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(countEmbeddedImages(pdf)).toBeGreaterThanOrEqual(1);
  });

  it("wraps ingredient lines at word boundaries, never mid-word", async () => {
    const ingredients = "Eggs, suger, salt, dark chocolate, irhu dark chocolate, ";
    const bytes = await renderLabelPreviewPdf({ ...input, ingredients });
    const pdf = await PDFDocument.load(bytes);
    const lines = ingredientsLines(pdf);

    expect(lines.length).toBeGreaterThan(1);
    // Line breaks only occur between words: re-joining the rendered lines
    // with single spaces reproduces the declaration exactly, so "dark"
    // can never be drawn as "da" + "rk".
    expect(lines.join(" ")).toBe(`Ingredients:${normalizeIngredientsSpacing(ingredients).trim()}`);
    expect(lines.some((line) => line.endsWith(" da"))).toBe(false);
    expect(lines.some((line) => line.startsWith("rk"))).toBe(false);
    // The first value word stays glued to the bold label, like the DOCX.
    expect(lines[0].startsWith("Ingredients:Eggs,")).toBe(true);
  });
});
