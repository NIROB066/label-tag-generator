---
name: label-document-workflow
description: "Use when implementing or debugging label DOCX generation, DOCX inspection, GS1/GTIN barcode validation, barcode replacement, or sample-label fixture tests in this repository."
---

# Label Document Workflow

Use this workflow for changes that touch the label package, barcode payload, or repair experience.

## Before coding

1. Read `SPEC.md`, `PLAN.md`, and `agents.md`.
2. Treat `sample/*.docx` as read-only fixtures.
3. Inspect the DOCX as an OOXML ZIP package and record:
   - page size and margins;
   - all text-box text and drawing names;
   - image relationship targets and media dimensions;
   - candidate barcode image and its surrounding human-readable text.
4. Confirm the requested barcode symbology before claiming Canada/GS1 compliance.

## Canonical data rules

- Keep the expected barcode number as structured data, separate from decoded scan data.
- Normalize user input at the boundary, then validate GTIN length and check digit.
- Treat the expected barcode number as authoritative during repair.
- Human-readable AI delimiters such as `(01)`, `(15)`, and `(10)` may be displayed in text, but parentheses must not be present in encoded barcode data.
- Keep lot and best-before values separate from the GTIN.
- Do not infer a correct barcode from a corrupted scan without presenting the mismatch to the user.

## DOCX handling

- Use ZIP and XML parsers with safe limits; do not parse OOXML with broad regular expressions.
- Resolve `rId` references through `document.xml.rels`; relationship IDs and XML order are not stable contracts.
- Preserve unrelated XML, text boxes, media, page geometry, and template styling.
- For repairs, replace only the barcode image and the associated human-readable barcode text unless the user explicitly changes another field.
- Never execute macros, external relationships, or embedded document content.
- Reject malformed packages, unsafe paths, decompression overages, and XML entity expansion.

## Barcode verification loop

1. Build the expected structured payload from validated fields.
2. Generate barcode artwork with human-readable text disabled.
3. Insert the artwork into the bounded barcode region.
4. Reopen the generated DOCX package.
5. Decode the barcode from the resulting media/rendered label.
6. Compare decoded data with the expected structured payload.
7. Return a field-specific error if any comparison fails.

A successful file write is not a successful repair until the output has been reopened and decoded.

## Tests to add or update

- Valid and invalid GTIN check digits.
- GTIN normalization and forbidden-character handling.
- AI payload encoding with no parentheses in encoded data.
- Barcode generation with no human-readable digits below the bars.
- Sample fixture extraction for both supplied labels.
- Matching, mismatching, unreadable, and missing barcode cases.
- Corrupt ZIP/XML and oversized upload cases.
- Output package preservation and post-repair decode.

## Completion checklist

- Focused domain or fixture tests pass.
- The changed output still has 6x4 page geometry.
- The original sample fixtures are unchanged.
- Error results identify filename, field, error code, and repair action.
- No document contents or barcode values are added to logs.
