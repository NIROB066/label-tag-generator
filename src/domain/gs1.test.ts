import { describe, expect, it } from "vitest";
import {
  buildGs1Payload,
  isValidGtin,
  normalizeGtinTo14,
  parseGs1Payload,
} from "@/domain/gs1";
import { LabelValidationError } from "@/domain/label-schema";

describe("GTIN validation", () => {
  it("accepts a valid 14-digit GTIN", () => {
    expect(isValidGtin("10627146285749")).toBe(true);
  });

  it("rejects a bad check digit", () => {
    expect(isValidGtin("10627146285748")).toBe(false);
  });

  it("normalizes a valid GTIN to 14 digits", () => {
    expect(normalizeGtinTo14("036000291452")).toBe("00036000291452");
  });

  it("rejects parentheses in the expected barcode number", () => {
    expect(() => normalizeGtinTo14("(01)10627146285749")).toThrow(
      LabelValidationError,
    );
  });
});

describe("GS1 payloads", () => {
  const input = {
    gtin: "10627146285749",
    bestBefore: "2025-09-23",
    lotCode: "72722",
  };

  it("builds encoded and human-readable values separately", () => {
    const payload = buildGs1Payload(input);

    expect(payload.encoded).toBe("0110627146285749152509231072722");
    expect(payload.encoded).not.toContain("(");
    expect(payload.humanReadable).toBe("(01)10627146285749(15)250923(10)72722");
  });

  it("round trips a payload back to structured fields", () => {
    const payload = buildGs1Payload(input);

    expect(parseGs1Payload(payload.encoded)).toEqual({
      gtin: "10627146285749",
      bestBefore: "2025-09-23",
      lotCode: "72722",
    });
  });

  it("rejects encoded parentheses", () => {
    expect(() => parseGs1Payload(payloadWithParentheses())).toThrow(
      "must not contain parentheses",
    );
  });
});

function payloadWithParentheses(): string {
  return "(01)10627146285749(15)250923(10)72722";
}
