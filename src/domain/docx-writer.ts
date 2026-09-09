import {
  AlignmentType,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { LabelInput } from "@/domain/label-schema";
import { buildGs1Payload } from "@/domain/gs1";

export async function generateLabelDocx(
  input: LabelInput,
  barcodePng: Buffer,
): Promise<Buffer> {
  const payload = buildGs1Payload(input);
  const document = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: 5760, height: 8640 },
            margin: { top: 720, right: 720, bottom: 720, left: 720 },
          },
        },
        children: [
          paragraph("GASTRONOMIQUE PASTRY INC", {
            bold: true,
            size: 22,
            color: "17211F",
            spacing: { after: 180 },
          }),
          paragraph(input.productName, {
            bold: true,
            size: 34,
            color: "17211F",
            spacing: { after: 120 },
          }),
          paragraph(`ITEM #${input.itemNumber}`, {
            bold: true,
            size: 18,
            color: "4E5A56",
            spacing: { after: 360 },
          }),
          paragraph(input.storageInstruction, {
            bold: true,
            size: 20,
            color: "B74932",
            spacing: { after: 300 },
          }),
          paragraph("Ingredients", {
            bold: true,
            size: 18,
            color: "17211F",
            spacing: { after: 80 },
          }),
          paragraph(input.ingredients, {
            size: 15,
            color: "3C4743",
            spacing: { after: 260 },
          }),
          paragraph(`LOT CODE: ${input.lotCode}`, {
            bold: true,
            size: 18,
            color: "17211F",
            spacing: { after: 60 },
          }),
          paragraph(`BEST BEFORE: ${input.bestBefore.replaceAll("-", "/")}`, {
            bold: true,
            size: 18,
            color: "17211F",
            spacing: { after: 220 },
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new ImageRun({
                type: "png",
                data: barcodePng,
                transformation: { width: 300, height: 80 },
                altText: {
                  name: "GS1 barcode",
                  title: "GS1 barcode",
                  description: "Machine-readable product barcode",
                },
              }),
            ],
            spacing: { after: 80 },
          }),
          paragraph(payload.humanReadable, {
            alignment: AlignmentType.CENTER,
            size: 10,
            color: "4E5A56",
          }),
        ],
      },
    ],
  });

  return Packer.toBuffer(document);
}

function paragraph(
  text: string,
  options: {
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
    bold?: boolean;
    color?: string;
    size?: number;
    spacing?: { after: number };
  } = {},
): Paragraph {
  return new Paragraph({
    alignment: options.alignment,
    spacing: options.spacing,
    children: [
      new TextRun({
        text,
        bold: options.bold,
        color: options.color,
        size: options.size,
      }),
    ],
  });
}
