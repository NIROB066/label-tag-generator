import { describe, expect, it } from "vitest";
import { buildGs1Payload } from "@/domain/gs1";
import { generateGs1BarcodePng } from "@/domain/barcode";
import { inspectDocx } from "@/domain/docx-reader";
import { generateLabelDocx } from "@/domain/docx-writer";

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
    const document = await generateLabelDocx(input, barcode);
    const inspection = await inspectDocx(document);

    expect(inspection.page).toEqual({
      widthTwips: 5760,
      heightTwips: 8640,
      marginsTwips: { top: 720, right: 720, bottom: 720, left: 720 },
    });
    expect(inspection.documentText).toContain("Lava Cake 3 Inch");
    expect(inspection.documentText).toContain("LOT CODE: 72722");
    expect(inspection.images).toHaveLength(1);
  });
});
