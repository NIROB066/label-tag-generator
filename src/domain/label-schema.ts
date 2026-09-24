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
  | "BEST_BEFORE_INVALID"
  | "BARCODE_NOT_FOUND"
  | "BARCODE_UNREADABLE"
  | "BARCODE_VALUE_MISMATCH"
  | "LOT_MISMATCH"
  | "BEST_BEFORE_MISMATCH";

export class LabelValidationError extends Error {
  readonly code: ValidationErrorCode;

  constructor(code: ValidationErrorCode, message: string) {
    super(message);
    this.name = "LabelValidationError";
    this.code = code;
  }
}

export type ScanStatus = "ready" | "attention" | "error";

export type LabelScanResult = {
  filename: string;
  productName: string;
  itemNumber: string;
  expectedGtin: string;
  expectedLotCode: string;
  expectedBestBefore: string;
  expectedIngredients: string;
  expectedStorageInstruction: string;
  expectedBarcodeText: string;
  /** Full expected barcode number with parentheses/AI delimiters stripped. */
  expectedBarcodeNumber: string | null;
  scannedRaw: string | null;
  /** Full scanned barcode number with parentheses/AI delimiters stripped. */
  scannedBarcodeNumber: string | null;
  scannedGtin: string | null;
  scannedLotCode: string | null;
  scannedBestBefore: string | null;
  barcodeMediaFile: string | null;
  barcodeImageBase64: string | null;
  status: ScanStatus;
  detail: string;
  mismatches: Array<{
    field: string;
    expected: string;
    actual: string;
    message: string;
    code?: ValidationErrorCode;
  }>;
  widthEmu?: number;
  heightEmu?: number;
};

