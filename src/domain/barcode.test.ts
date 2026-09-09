import { describe, expect, it } from "vitest";
import { buildGs1Payload } from "@/domain/gs1";
import { generateGs1BarcodePng } from "@/domain/barcode";

const payload = buildGs1Payload({
  gtin: "10627146285749",
  bestBefore: "2025-09-23",
  lotCode: "72722",
});

describe("GS1 barcode generation", () => {
  it("returns a PNG with nonzero dimensions and no text option", async () => {
    const png = await generateGs1BarcodePng(payload);

    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(png.readUInt32BE(16)).toBeGreaterThan(0);
    expect(png.readUInt32BE(20)).toBeGreaterThan(0);
  });
});
