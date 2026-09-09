export type LabelInput = {
  productName: string;
  itemNumber: string;
  gtin: string;
  lotCode: string;
  bestBefore: string;
  ingredients: string;
  storageInstruction: string;
};

export type Gs1Payload = {
  gtin: string;
  bestBefore: string;
  lotCode: string;
  encoded: string;
  humanReadable: string;
};

export type Gs1ParseResult = {
  gtin: string;
  bestBefore: string;
  lotCode: string;
};

export type BarcodeRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ValidationErrorCode =
  | "EXPECTED_GTIN_INVALID"
  | "GS1_PAYLOAD_INVALID"
  | "LOT_INVALID"
  | "BEST_BEFORE_INVALID";

export class LabelValidationError extends Error {
  readonly code: ValidationErrorCode;

  constructor(code: ValidationErrorCode, message: string) {
    super(message);
    this.name = "LabelValidationError";
    this.code = code;
  }
}
