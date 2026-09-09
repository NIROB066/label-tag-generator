import {
  Gs1ParseResult,
  Gs1Payload,
  LabelValidationError,
} from "@/domain/label-schema";

const GTIN_LENGTHS = new Set([8, 12, 13, 14]);
const GROUP_SEPARATOR = "\u001d";

export function normalizeGtin(value: string): string {
  const normalized = value.trim().replace(/[\s-]/g, "");

  if (normalized.includes("(") || normalized.includes(")")) {
    throw new LabelValidationError(
      "EXPECTED_GTIN_INVALID",
      "GTIN must contain digits only; remove parentheses before continuing.",
    );
  }

  return normalized;
}

export function isValidGtin(value: string): boolean {
  const normalized = normalizeGtin(value);

  if (!GTIN_LENGTHS.has(normalized.length) || !/^\d+$/.test(normalized)) {
    return false;
  }

  const digits = normalized.split("").map(Number);
  const checkDigit = digits.pop();

  if (checkDigit === undefined) {
    return false;
  }

  let sum = 0;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const distanceFromRight = digits.length - index;
    sum += digits[index] * (distanceFromRight % 2 === 1 ? 3 : 1);
  }

  return (10 - (sum % 10)) % 10 === checkDigit;
}

export function normalizeGtinTo14(value: string): string {
  const normalized = normalizeGtin(value);

  if (!isValidGtin(normalized)) {
    throw new LabelValidationError(
      "EXPECTED_GTIN_INVALID",
      "Enter a valid GTIN with a correct check digit.",
    );
  }

  return normalized.padStart(14, "0");
}

function normalizeBestBefore(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime())) {
    throw new LabelValidationError(
      "BEST_BEFORE_INVALID",
      "Best-before date must use a valid YYYY-MM-DD date.",
    );
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  if (`${year}-${month}-${day}` !== value) {
    throw new LabelValidationError(
      "BEST_BEFORE_INVALID",
      "Best-before date must use a real calendar date.",
    );
  }

  return `${String(year).slice(-2)}${month}${day}`;
}

function normalizeLotCode(value: string): string {
  const normalized = value.trim();

  if (!normalized || /[\u0000-\u001f()]/.test(normalized)) {
    throw new LabelValidationError(
      "LOT_INVALID",
      "Lot code must contain visible characters without parentheses or control characters.",
    );
  }

  return normalized;
}

export function buildGs1Payload(input: {
  gtin: string;
  bestBefore: string;
  lotCode: string;
  [key: string]: unknown;
}): Gs1Payload {
  const gtin = normalizeGtinTo14(input.gtin);
  const bestBefore = normalizeBestBefore(input.bestBefore);
  const lotCode = normalizeLotCode(input.lotCode);

  return {
    gtin,
    bestBefore,
    lotCode,
    encoded: `01${gtin}15${bestBefore}10${lotCode}`,
    humanReadable: `(01)${gtin}(15)${bestBefore}(10)${lotCode}`,
  };
}

export function parseGs1Payload(encoded: string): Gs1ParseResult {
  if (encoded.includes("(") || encoded.includes(")")) {
    throw new LabelValidationError(
      "GS1_PAYLOAD_INVALID",
      "Encoded GS1 data must not contain parentheses.",
    );
  }

  const normalized = encoded.replaceAll(GROUP_SEPARATOR, "");
  const prefix = /^01(\d{14})15(\d{6})10(.+)$/.exec(normalized);

  if (!prefix) {
    throw new LabelValidationError(
      "GS1_PAYLOAD_INVALID",
      "Expected GS1 AIs 01, 15, and 10 in that order.",
    );
  }

  const [, gtin, date, lotCode] = prefix;
  const bestBefore = `20${date.slice(0, 2)}-${date.slice(2, 4)}-${date.slice(4, 6)}`;

  if (!isValidGtin(gtin)) {
    throw new LabelValidationError(
      "GS1_PAYLOAD_INVALID",
      "The GTIN inside the GS1 payload has an invalid check digit.",
    );
  }

  return { gtin, bestBefore, lotCode };
}
