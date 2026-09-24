# Label Tag Generator Implementation Plan

## 1. Goal

Build a deployable Next.js application for creating and validating 6x4 inch food-product labels from the supplied DOCX examples.

The app has two primary workflows:

1. **Generate**: collect label data, generate a scannable Canada-compliant GS1 barcode, and download a complete `.docx` label.
2. **Inspect and fix**: upload one or more `.docx` labels, extract the expected barcode payload and visible fields, scan/validate the barcode, show errors in a dashboard, and replace incorrect barcode artwork one label at a time.

The application must not use the client's marketplace name, logo, or branding in the UI.

## 2. Findings from the supplied samples

- Both samples are Office Open XML `.docx` packages with `word/document.xml`, two embedded images, and no separate `document.xml` header/footer parts.
- Page geometry is `5760 x 8640` twentieths of a point, which is 4 x 6 inches in portrait orientation. Margins are 1 inch on every side.
- Important visible content is stored in floating Word text boxes, including product name, item number, lot code, best-before date, storage text, ingredients, and the human-readable GS1 string.
- The samples contain a product/logo JPEG and a second PNG asset. Barcode artwork is represented by an embedded image relationship and must be treated as replaceable artwork rather than trusted text.
- Sample payloads use GS1 Application Identifiers such as `(01)` GTIN, `(15)` best-before date, and `(10)` lot/batch. Parentheses are human-readable AI delimiters and must not be encoded in the barcode data itself.
- The visible barcode value is an important validation signal, but the expected barcode number entered by the user is authoritative when repairing a label.

These observations must be verified with automated fixtures before implementation decisions are considered final. Do not assume every future document has exactly the same relationship IDs or text-box ordering.

## Implementation status

- Phase 0 fixture extraction: implemented for both supplied samples.
- Phase 1 GS1/GTIN domain validation: implemented and covered by unit tests.
- Initial Create/Inspect workbench: implemented with browser smoke coverage.
- Barcode PNG and exact sample-template 6x4 DOCX generation: implemented and package-tested. The writer preserves the sample package and replaces only scoped text and barcode media.
- Barcode decode and batch scan API: implemented. Inspection treats the written barcode number as the truth and fully compares the scanned artwork — GTIN, best-before `(15)`, lot `(10)`, and the complete paren-stripped barcode number — with missing components reported as errors carrying stable codes (`BARCODE_VALUE_MISMATCH`, `BEST_BEFORE_MISMATCH`, `LOT_MISMATCH`, `BARCODE_NOT_FOUND`, `BARCODE_UNREADABLE`).
- Template placeholders centralized in `src/domain/label-template.ts` (text-box names, media paths, EMU geometry) and auto-fit typography in `src/domain/label-typography.ts` (two-line title shrinking, progressive ingredient shrinking), both unit-tested.
- Repair: single and batch repair regenerate the full label from the template using the scanned expected values (including ingredients and storage instruction), and correction UI is hidden for verified labels.

## 3. Recommended architecture

### Application

- Next.js App Router with TypeScript.
- Responsive single-page workbench with two top-level modes: **Create label** and **Inspect labels**.
- Server-side route handlers for DOCX parsing/generation where binary processing or filesystem access is required.
- Keep uploaded files in memory or temporary storage only; do not persist client label contents by default.
- Use a small domain layer independent of React for parsing, GS1 validation, barcode generation, and DOCX mutation.

### Domain modules

- `src/domain/label-schema.ts`: canonical label input, extracted label, barcode, validation, and repair types.
- `src/domain/gs1.ts`: normalize user input, validate GTIN check digits, build/parse AI payloads, and enforce the no-parentheses-in-encoded-data rule.
- `src/domain/docx-reader.ts`: inspect DOCX ZIP/XML parts, text boxes, image relationships, page geometry, and candidate barcode images.
- `src/domain/docx-writer.ts`: generate or mutate the label while preserving the known template layout and replacing only the barcode image/text that must change.
- `src/domain/barcode.ts`: generate the chosen GS1-128 or GS1 DataBar-compatible artwork with no human-readable digits underneath, and expose a scanner-verification function.
- `src/domain/validation.ts`: compare expected structured fields to extracted text and decoded barcode values, returning stable error codes and field locations.

The exact barcode symbology must be confirmed during discovery with the client and scanner requirements. Do not label a plain Code 128 output as "Canada GTIN compliant" without confirming the required carrier symbology and GS1 rules.

### UI surfaces

- Overview dashboard: total uploaded, valid, needs attention, scan failures, and grouped error counts.
- Create form: product/item/GTIN/lot/best-before/ingredients/storage inputs, template selection, preview, and DOCX download.
- Inspection queue: one row per label with filename, product, expected barcode, decoded barcode, status, and error summary.
- Label repair view: document preview or rendered label, field-level error callouts, resizable barcode rectangle, authoritative barcode input, regenerate/verify action, and download repaired DOCX.

## 4. Delivery phases

### Phase 0: Discovery and fixtures

- Preserve the supplied samples as read-only fixtures.
- Create a script or test fixture extractor that records page geometry, all text-box text, image relationships, image dimensions, and candidate barcode locations.
- Open the embedded PNG/JPEG assets and determine which image is the barcode versus logo/product art.
- Confirm expected barcode symbology and the meaning of each AI with the client or authoritative GS1 guidance.
- Define accepted GTIN lengths, check-digit rules, date encoding, lot character constraints, and failure behavior.

**Exit criteria:** both samples produce a stable normalized representation and the barcode asset is identified without relying on hard-coded relationship IDs.

### Phase 1: Domain correctness first

- Implement the canonical schema and normalization rules.
- Implement GTIN check-digit validation.
- Implement AI payload creation/parsing with parentheses excluded from encoded data.
- Implement barcode generation with disabled human-readable text.
- Add scanner round-trip tests and malformed-input tests.

**Exit criteria:** unit tests prove valid/invalid GTINs, correct GS1 payloads, no parentheses in encoded bytes, date/lot extraction, and barcode round-trips.

### Phase 2: DOCX read/write pipeline

- Parse DOCX ZIP/XML using XML-aware libraries, not regular expressions over the full package.
- Resolve image relationships through relationship metadata.
- Preserve all unrelated document XML and media.
- Implement generation from a controlled template and repair by replacing the barcode image plus the associated human-readable GS1 text.
- Preserve page size, margins, product art, ingredients, and text-box positioning.

**Exit criteria:** generated and repaired files open in Word/LibreOffice, retain 6x4 layout, contain a scannable barcode, and do not show human-readable digits below the barcode.

### Phase 3: API and UI

- Add upload validation for `.docx`, file count, size, and malformed packages.
- Add batch inspection with bounded concurrency and per-file failure isolation.
- Add dashboard, queue, detail, and repair interactions.
- Make the barcode rectangle keyboard-accessible and constrain resizing to the label canvas.
- Add loading, empty, partial-failure, and download states.

**Exit criteria:** a user can generate a label, upload multiple labels, identify failures, repair one label, verify it, and download it without leaving the app.

### Phase 4: Verification and deployment

- Add unit tests for domain logic, fixture tests for both samples, API tests, and browser tests for the two main workflows.
- Test DOCX output with package-level assertions and barcode decode, not only screenshots.
- Run accessibility checks at desktop and mobile widths.
- Add Vercel build configuration and document runtime limits for binary processing.
- Add privacy and retention notes to the UI and README.

**Exit criteria:** CI passes lint, typecheck, unit/integration tests, and production build; the deployed app handles the sample fixtures and documents known limits.

## 5. Error model

Use stable, user-readable error codes rather than string matching in the UI:

- `INVALID_FILE_TYPE`
- `DOCX_PACKAGE_INVALID`
- `LABEL_TEMPLATE_UNRECOGNIZED`
- `EXPECTED_GTIN_INVALID`
- `BARCODE_NOT_FOUND`
- `BARCODE_UNREADABLE`
- `BARCODE_VALUE_MISMATCH`
- `GS1_PAYLOAD_INVALID`
- `LOT_MISMATCH`
- `BEST_BEFORE_MISMATCH`
- `BARCODE_REGION_INVALID`
- `OUTPUT_VERIFICATION_FAILED`

Every error should include the affected field, filename, and a concise repair action. A barcode decode failure must not silently overwrite the authoritative expected barcode.

## 6. Security, privacy, and operational constraints

- Reject files by extension and detected DOCX ZIP structure; enforce upload size and count limits.
- Treat XML, text-box content, filenames, and embedded media as untrusted input.
- Defend against ZIP bombs, oversized decompression, XML entity expansion, path traversal, and unsafe XML parsing.
- Never execute macros or external relationships from uploaded documents.
- Keep uploads ephemeral and avoid logging document contents, GTINs, lot codes, or personal data.
- Do not expose arbitrary filesystem paths or accept arbitrary template paths from the browser.
- Prefer Node.js runtime for server routes that need ZIP/XML/image processing; verify Vercel limits before choosing serverless versus a separate worker.

## 7. Design direction

Use a focused production workbench rather than a marketing landing page:

- Strong two-mode navigation: Create and Inspect.
- High-signal status colors with text labels and icons, never color alone.
- Dense but readable inspection tables and a clear selected-label repair pane.
- A warm food-label palette anchored by ink, paper, and one contrasting safety color; avoid marketplace branding and generic purple SaaS styling.
- Show the real label preview early. Keep actions prominent: Generate, Scan, Repair, Verify, Download.
- Make desktop efficient for batch work and mobile usable for reviewing one label at a time.

## 8. Definition of done

- [x] User can enter an editable barcode number and all label fields.
- [x] GTIN check digit and allowed input format are validated before generation.
- [x] Encoded barcode data contains no parentheses and rendered barcode has no digits beneath it.
- [x] Generated DOCX matches the supplied 6x4 label geometry and preserves template assets.
- [x] Multiple DOCX labels can be uploaded and inspected independently.
- [x] Dashboard shows counts and identifies labels needing attention.
- [x] User can navigate labels one by one and see exact field-level errors.
- [x] User can resize/reposition the barcode rectangle within the label bounds.
- [x] Repair removes/replaces the old barcode and verifies the new artwork by decoding it.
- [x] Output DOCX can be downloaded and reopened.
- [x] Tests cover valid, invalid, mismatched, unreadable, and malformed-document cases.
- [x] README documents local setup, test commands, deployment assumptions, and privacy behavior.

## 9. Open decisions to resolve before coding the UI

1. Is the required barcode GS1-128, GS1 DataMatrix, GS1 DataBar, or another symbology accepted by the client's scanner/printer?
2. Is the expected barcode always a 14-digit GTIN, or can GTIN-12/GTIN-13 values be entered and normalized?
3. Are labels always single-page 6x4 documents using one known template, or must users choose among templates?
4. Should generated labels use the existing logo/product art, or should the user upload/select those assets?
5. Is the app allowed to process client documents only in memory, or is authenticated project history required later?
6. What maximum file size and batch size are practical for the target users?

## 10. Tooling note

Context7 was requested for current framework documentation but the configured connector rejected the local API key during planning. Re-run the framework/deployment documentation lookup after the key is repaired before pinning package versions or relying on provider-specific limits.
