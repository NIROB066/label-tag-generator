import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectDocx } from "@/domain/docx-reader";

const samples = [
  "Lava Cake Label 6''x4''.docx",
  "Raspberry cheesecake  Label (6''x4'').docx",
];

describe("sample DOCX inspection", () => {
  it.each(samples)("extracts stable label structure from %s", async (filename) => {
    const input = await readFile(path.join(process.cwd(), "sample", filename));
    const inspection = await inspectDocx(input);

    expect(inspection.page).toEqual({
      widthTwips: 5760,
      heightTwips: 8640,
      marginsTwips: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
    });
    expect(inspection.textBoxes.length).toBeGreaterThanOrEqual(4);
    expect(inspection.images).toHaveLength(2);
    expect(inspection.images.map((image) => image.relationshipId)).toEqual(
      expect.arrayContaining(["rId4", "rId5"]),
    );
    expect(inspection.documentText).toContain("BEST BEFORE");
  });
});
