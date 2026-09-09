# Project Agent Instructions

These instructions apply to every agent working on the label-tag-generator repository, including Claude Code and GitHub Copilot.

## Read first

- Read `SPEC.md` for the product request.
- Read `PLAN.md` before making architectural or workflow changes.
- Treat files under `sample/` as read-only reference fixtures. Do not rename, rewrite, or replace them.

## Product contract

- Build a Next.js application deployable to Vercel.
- Support two workflows: generate a new 6x4 label DOCX and inspect/repair one or more uploaded label DOCX files.
- Do not use the client's marketplace name or logo in the product UI.
- The user-entered expected barcode number is authoritative during repair.
- Validate GTIN check digits and confirm the required GS1 symbology before finalizing implementation.
- Parentheses may appear as human-readable AI delimiters, but must never be encoded into barcode data.
- Generated barcode artwork must not render human-readable digits beneath the bars.
- Preserve the sample label's 6x4 layout, dimensions, and unrelated assets when generating or repairing DOCX files.

## Engineering rules

- Start with domain types and tests before building broad UI.
- Keep GS1 logic, barcode generation/decoding, DOCX parsing, and DOCX mutation in framework-independent modules.
- Parse DOCX as a ZIP/XML package with safe, structured parsers. Never use regular expressions as the primary XML parser.
- Resolve relationships by relationship metadata, never by assuming `rId` values or element order.
- Treat uploaded documents, XML text, filenames, and embedded media as untrusted.
- Reject malformed or oversized packages and prevent XML entity expansion, ZIP bombs, path traversal, macros, and external relationship execution.
- Do not log uploaded document contents, GTINs, lot codes, or other client data.
- Do not add persistence unless the product explicitly requires it; prefer ephemeral processing.
- Preserve existing user changes and keep edits narrowly scoped.
- Do not add dependencies until their current documentation and runtime compatibility are checked.
- Do not commit secrets, generated uploads, or local output files.

## Workflow

1. Identify the owning domain module or test from the request.
2. State one falsifiable local hypothesis and one cheap validation check before the first edit.
3. Make the smallest change that tests the hypothesis.
4. Run a focused test, typecheck, lint, or package-level validation immediately after the edit.
5. Keep behavior changes covered by tests, especially around barcode payloads and DOCX output.
6. Before finishing, run the narrowest relevant checks plus the production build when the project has one.

## Testing expectations

Required coverage includes:

- GTIN check-digit validation and normalization.
- AI payload creation/parsing with parentheses excluded from encoded bytes.
- Barcode generation with no human-readable text and scanner round-trip verification.
- Sample DOCX extraction for text boxes, page geometry, media, and candidate barcode artwork.
- Repair of matching, mismatching, unreadable, and malformed labels.
- Batch isolation: one bad upload must not hide results for valid uploads.
- Browser tests for create, inspect, repair, verify, and download flows.

## UI expectations

- Use a practical workbench with Create and Inspect modes.
- Make dashboard status counts and per-label errors obvious.
- Use labels and icons together; never communicate errors by color alone.
- Make the barcode region visible, bounded, resizable, keyboard-accessible, and verifiable.
- Show loading, empty, partial-failure, success, and download states.
- Keep typography and color intentional, readable, and distinct from generic marketplace dashboards.

## Hooks and automation

Do not add lifecycle hooks until package scripts and a stable test/lint command exist. Once they exist, a minimal hook may run formatting/type checks on changed source files, but it must not process uploaded documents or rewrite the sample fixtures. Any hook must be deterministic, fast, documented, and safe to bypass for emergency debugging.

## Completion report

Every implementation response should summarize:

- Files changed.
- Behavior added or fixed.
- Focused validation commands and results.
- Remaining open decisions or known limitations.
