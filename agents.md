<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project guide: Label Tag Generator

Next.js 16 App Router + TypeScript app that creates 6x4 food-label DOCX files with GS1-128 barcodes and verifies/repairs uploaded label files.

## Commands

```bash
npm run dev        # dev server
npm test           # vitest (node environment)
npm run lint       # eslint
npm run build      # production build
```

Run `npm test`, `npm run lint`, and `npx tsc --noEmit` before finishing any change.

## Architecture

- `src/domain/` — framework-free, unit-tested core:
  - `label-schema.ts`: shared types (`LabelInput`, `LabelScanResult`, `ValidationErrorCode`).
  - `gs1.ts`: GTIN check-digit validation, GS1 payload build/parse, `toBarcodeNumber` (strips `()`/`]C1`/separators).
  - `label-template.ts`: single source of truth for template text-box names, media paths, and EMU geometry. Never hardcode `"Text Box N"` or EMU numbers elsewhere.
  - `label-typography.ts`: pure auto-fit rules — title shrinks to at most two wrapped lines; ingredients shrink progressively by length. Keep pure and tested.
  - `barcode.ts` (bwip-js PNG), `docx-writer.ts` (template mutation), `docx-reader.ts` (safe inspection), `barcode-scanner.ts` (decode + full compare), `docx-repair.ts` (surgical in-place patch path).
- `src/app/page.tsx` — single client page, two modes (Create / Check & fix).
- `src/app/api/labels/*` — Node-runtime route handlers (generate, scan, repair, batch-repair, barcode, logo).

## Invariants

- The barcode number written on the document is the truth. Scans compare GTIN, best-before `(15)`, lot `(10)`, and the full paren-stripped number; a component written on the label but missing from the artwork is an error (`BEST_BEFORE_MISMATCH`, `LOT_MISMATCH`, `BARCODE_VALUE_MISMATCH`).
- Repair always regenerates the full label from the template (same pipeline as Create) using scanned expected values, including ingredients and storage instruction. Correction UI stays hidden for verified labels.
- Encoded barcode data never contains parentheses; rendered barcodes have no human-readable digits beneath them.
- `sample/` and `Issue/` DOCX files are read-only fixtures relied on by tests.
- Tests must stay green: worktree checkouts under `.kilo/` are excluded from vitest and eslint.
