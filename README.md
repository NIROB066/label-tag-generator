# Label Tag Generator

Project planning and implementation guidance:

- [PLAN.md](PLAN.md): phased product, architecture, security, testing, and deployment plan.
- [agents.md](agents.md): shared instructions for Claude Code and other coding agents.
- [SPEC.md](SPEC.md): original product specification.
- `sample/`: read-only DOCX reference fixtures.

## Current implementation

- Create and check-and-fix workbench UI with responsive desktop/mobile layout.
- GS1/GTIN normalization, check-digit validation, and AI payload parsing.
- Safe DOCX fixture inspection for page geometry, text boxes, relationships, and images.
- Server-side GS1-128 PNG generation with human-readable barcode text disabled.
- Server-side 6x4 DOCX generation by mutating the supplied sample template, preserving its floating text boxes, logo, artwork, margins, and Word package structure.
- Template structure (text-box names, media paths, geometry) is centralized in `src/domain/label-template.ts` instead of magic strings.
- Auto-sizing typography (`src/domain/label-typography.ts`): the product title shrinks to fit at most two wrapped lines, and ingredient declarations shrink progressively as they grow.
- Barcode inspection decodes the embedded artwork and treats the number written on the label as the truth: GTIN, best-before date, lot code, and the full paren-stripped barcode number are all compared; missing components are errors, not warnings.
- Repair regenerates the full label from the template (same pipeline as Create) using the scanned expected values, including ingredients and storage instruction, and the correction UI is hidden for labels that already pass every check.

## Verification rules

The written barcode number on the document is authoritative. When scanning:

1. The full scanned barcode number (parentheses, `]C1`, and separators stripped via `toBarcodeNumber`) is displayed and compared.
2. Each component — GTIN, best-before `(15)`, lot `(10)` — is checked individually; a component present in the written text but missing from the artwork is a mismatch with a stable code (`BEST_BEFORE_MISMATCH`, `LOT_MISMATCH`, `BARCODE_VALUE_MISMATCH`, ...).
3. A label is `ready` only when every check passes. `attention` labels show the correction tools; verified labels do not.

## Commands

```bash
npm install
npm run dev
npm test
npm run lint
npm run build
```
