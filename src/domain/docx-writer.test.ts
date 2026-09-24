import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildGs1Payload } from "@/domain/gs1";
import { generateGs1BarcodePng } from "@/domain/barcode";
import { inspectDocx } from "@/domain/docx-reader";
import { generateLabelDocxFromTemplate } from "@/domain/docx-writer";
import {
  pickIngredientFontSize,
  pickTitleFontSize,
} from "@/domain/label-typography";

const input = {
  productName: "Lava Cake 3 Inch",
  itemNumber: "GP2118",
  gtin: "10627146285749",
  lotCode: "72722",
  bestBefore: "2025-09-23",
  ingredients: "Eggs, sugar, wheat flour, margarine, dark chocolate.",
  storageInstruction: "KEEP FROZEN",
};

describe("DOCX label generation", () => {
  it("creates a 6x4 DOCX with the expected fields and barcode image", async () => {
    const barcode = await generateGs1BarcodePng(buildGs1Payload(input));
    const template = await readFile(
      path.join(process.cwd(), "sample", "Lava Cake Label 6''x4''.docx"),
    );
    const document = await generateLabelDocxFromTemplate(template, input, barcode);
    const inspection = await inspectDocx(document);

    expect(inspection.page).toEqual({
      widthTwips: 5760,
      heightTwips: 8640,
      marginsTwips: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
    });
    expect(inspection.documentText).toContain("Lava Cake 3 Inch");
    expect(inspection.documentText).toContain("LOT CODE: 72722");
    expect(inspection.documentText).toContain("BEST BEFORE: 2025/09/23");
    expect(inspection.documentText).toContain("(01)10627146285749(15)250923(10)72722");
    expect(inspection.images).toHaveLength(2);
    expect(inspection.textBoxes.map((box) => box.name)).toEqual(
      expect.arrayContaining(["Text Box 1", "Text Box 2", "Text Box 3", "Text Box 4", "Text Box 5", "Text Box 7"]),
    );

    const originalZip = await JSZip.loadAsync(template);
    const generatedZip = await JSZip.loadAsync(document);
    expect(fileEntries(generatedZip)).toEqual(fileEntries(originalZip));
    expect(await generatedZip.file("word/media/image1.jpeg")?.async("base64")).toBe(
      await originalZip.file("word/media/image1.jpeg")?.async("base64"),
    );
    const originalXml = await originalZip.file("word/document.xml")?.async("text");
    const generatedXml = await generatedZip.file("word/document.xml")?.async("text");
    expect(generatedXml?.match(/<wp:anchor/g)).toHaveLength(originalXml?.match(/<wp:anchor/g)?.length ?? 0);

    const lotBox = namedAnchor(generatedXml ?? "", "Text Box 3");
    expect(lotBox.match(/<w:p\b/g)).toHaveLength(2);
    expect(lotBox).toContain("BEST BEFORE:");

    const ingredientsBox = namedAnchor(generatedXml ?? "", "Text Box 5");
    expect(ingredientsBox).toContain("Ingredients:");
    expect(ingredientsBox).toContain(input.ingredients);
    expect(ingredientsBox).toMatch(/<w:r[\s\S]*?<w:b[\s\S]*?<w:t>Ingredients:/);
    const ingredientsValueStart = ingredientsBox.indexOf("Eggs, sugar");
    const labelToValue = ingredientsBox.slice(ingredientsBox.indexOf("</w:t>", ingredientsBox.indexOf("Ingredients:")) + 6, ingredientsValueStart);
    expect(labelToValue).not.toContain("<w:b");

    const barcodeBox = namedAnchor(generatedXml ?? "", "Picture 7");
    expect(barcodeBox).toContain('<wp:extent cx="3108960" cy="740664"/>');
    expect(barcodeBox).toContain('<a:ext cx="3108960" cy="740664"/>');
    expect(namedAnchor(generatedXml ?? "", "Text Box 7")).toContain(
      "<wp:posOffset>912114</wp:posOffset>",
    );
  });

  it("shrinks long content without changing the template structure", async () => {
    const barcode = await generateGs1BarcodePng(buildGs1Payload(input));
    const template = await readFile(path.join(process.cwd(), "sample", "Lava Cake Label 6''x4''.docx"));
    const longInput = {
      ...input,
      productName: "Chocolate Raspberry Cheesecake Dessert Cups",
      ingredients: "Eggs, sugar, wheat flour, margarine, water, monoglycerides, potassium sorbate, citric acid, natural flavor, vitamin A palmitate, vitamin D3, dark chocolate, cocoa butter, unsweetened chocolate, soy lecithin, natural vanilla extract, stabilizer.",
    };
    const document = await generateLabelDocxFromTemplate(template, longInput, barcode);
    const zip = await JSZip.loadAsync(document);
    const xml = await zip.file("word/document.xml")?.async("text");
    const ingredientsBox = namedAnchor(xml ?? "", "Text Box 5");
    const productBox = namedAnchor(xml ?? "", "Text Box 2");

    expect(ingredientsBox).toContain('<wp:extent cx="3211195" cy="1508760"/>');
    expect(ingredientsBox).toContain(`<w:sz w:val="${pickIngredientFontSize(longInput.ingredients)}"/>`);
    expect(ingredientsBox).toContain('<w:sz w:val="18"/>');
    // The title auto-shrinks to the largest size that fits two wrapped lines.
    expect(productBox).toContain(`<w:sz w:val="${pickTitleFontSize(longInput.productName)}"/>`);
    expect(pickTitleFontSize(longInput.productName)).toBeLessThan(42);
  });

  it("auto-shrinks an extra-long title further and keeps it at or above the floor", async () => {
    const barcode = await generateGs1BarcodePng(buildGs1Payload(input));
    const template = await readFile(path.join(process.cwd(), "sample", "Lava Cake Label 6''x4''.docx"));
    const hugeTitleInput = {
      ...input,
      productName:
        "Chocolate Raspberry Cheesecake Dessert Cups with Whipped Cream Topping",
    };
    const document = await generateLabelDocxFromTemplate(template, hugeTitleInput, barcode);
    const zip = await JSZip.loadAsync(document);
    const xml = await zip.file("word/document.xml")?.async("text");
    const productBox = namedAnchor(xml ?? "", "Text Box 2");

    const expectedSize = pickTitleFontSize(hugeTitleInput.productName);
    expect(expectedSize).toBeLessThan(36);
    expect(productBox).toContain(`<w:sz w:val="${expectedSize}"/>`);
    expect(productBox).toContain(`<w:szCs w:val="${expectedSize}"/>`);
  });

  it("shrinks oversized ingredient declarations progressively", async () => {
    const barcode = await generateGs1BarcodePng(buildGs1Payload(input));
    const template = await readFile(path.join(process.cwd(), "sample", "Lava Cake Label 6''x4''.docx"));
    const hugeIngredientsInput = {
      ...input,
      ingredients: `Eggs, sugar, wheat flour, margarine, water, monoglycerides, potassium sorbate, citric acid, natural flavor, vitamin A palmitate, vitamin D3, dark chocolate, cocoa butter, unsweetened chocolate, soy lecithin, natural vanilla extract, stabilizer, ${"x".repeat(300)}`,
    };
    const document = await generateLabelDocxFromTemplate(template, hugeIngredientsInput, barcode);
    const zip = await JSZip.loadAsync(document);
    const xml = await zip.file("word/document.xml")?.async("text");
    const ingredientsBox = namedAnchor(xml ?? "", "Text Box 5");

    const expectedSize = pickIngredientFontSize(hugeIngredientsInput.ingredients);
    expect(expectedSize).toBeLessThan(18);
    expect(ingredientsBox).toContain(`<w:sz w:val="${expectedSize}"/>`);
    expect(ingredientsBox).toContain('<wp:extent cx="3211195" cy="1508760"/>');
  });
});

function fileEntries(zip: JSZip): string[] {
  return Object.keys(zip.files)
    .filter((entry) => !zip.files[entry].dir)
    .sort();
}

function namedAnchor(documentXml: string, name: string): string {
  const nameIndex = documentXml.indexOf(`name="${name}"`);
  const start = documentXml.lastIndexOf("<wp:anchor", nameIndex);
  const end = documentXml.indexOf("</wp:anchor>", nameIndex);
  return documentXml.slice(start, end + "</wp:anchor>".length);
}
