import { describe, expect, it } from "vitest";
import {
  buildGs1Payload,
  gtinCheckDigit,
  isValidGtin,
  normalizeGtinTo14,
  parseGs1Payload,
  suggestGtinCorrection,
  toBarcodeNumber,
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

describe("gtinCheckDigit", () => {
  it("computes the check digit for a GTIN-14 base", () => {
    expect(gtinCheckDigit("1062714628574")).toBe("9");
  });

  it("computes the check digit for a GTIN-12 base", () => {
    expect(gtinCheckDigit("03600029145")).toBe("2");
  });

  it("computes the check digit for a GTIN-13 base", () => {
    expect(gtinCheckDigit("590123412345")).toBe("7");
  });

  it("returns null for invalid bases", () => {
    expect(gtinCheckDigit("12345")).toBeNull();
    expect(gtinCheckDigit("1234567a")).toBeNull();
    expect(gtinCheckDigit("")).toBeNull();
  });
});

describe("suggestGtinCorrection", () => {
  it("suggests the corrected GTIN for a wrong check digit", () => {
    expect(suggestGtinCorrection("10627146285748")).toBe("10627146285749");
  });

  it("returns null when the GTIN is already correct", () => {
    expect(suggestGtinCorrection("10627146285749")).toBeNull();
  });

  it("returns null for wrong-length or non-digit input", () => {
    expect(suggestGtinCorrection("1234")).toBeNull();
    expect(suggestGtinCorrection("1062714628574abc9")).toBeNull();
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

describe("toBarcodeNumber", () => {
  it("strips parentheses from the human-readable form", () => {
    expect(toBarcodeNumber("(01)10627146285749(15)250923(10)72722")).toBe(
      "0110627146285749152509231072722",
    );
  });

  it("strips the GS1-128 symbology identifier some scanners emit", () => {
    expect(toBarcodeNumber("]C10110627146285749152509231072722")).toBe(
      "0110627146285749152509231072722",
    );
  });

  it("strips whitespace and group separators", () => {
    expect(toBarcodeNumber(" 0110627146285749 15 250923\u001d10 72722 ")).toBe(
      "0110627146285749152509231072722",
    );
  });

  it("leaves an already-plain barcode number untouched", () => {
    expect(toBarcodeNumber("0110627146285749152509231072722")).toBe(
      "0110627146285749152509231072722",
    );
  });
});

function payloadWithParentheses(): string {
  return "(01)10627146285749(15)250923(10)72722";
}
