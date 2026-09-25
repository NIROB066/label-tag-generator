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
  - `gs1.ts`: GTIN check-digit validation (`gtinCheckDigit`, `suggestGtinCorrection`), GS1 payload build/parse, `toBarcodeNumber` (strips `()`/`]C1`/separators).
  - `label-template.ts`: single source of truth for template text-box names, media paths, and EMU geometry. Never hardcode `"Text Box N"` or EMU numbers elsewhere.
  - `label-typography.ts`: pure auto-fit rules — title shrinks to at most two wrapped lines; ingredients shrink progressively by length. Keep pure and tested.
  - `barcode.ts` (bwip-js PNG), `docx-writer.ts` (template mutation), `docx-reader.ts` (safe inspection), `barcode-scanner.ts` (decode + full compare), `docx-repair.ts` (surgical in-place patch path).
- `src/app/page.tsx` — single client page: home choice screen, Create mode, and Check & fix mode (ZIP upload extraction, Fix-and-Download-ALL orchestration with progress, donut chart, prev/next + swipe paging, mobile bottom nav).
- `src/app/guide/` — print-to-PDF business user guide with annotated diagrams.
- `src/app/api/labels/*` — Node-runtime route handlers (generate, scan, repair, barcode, logo). Batch repair runs client-side per file over the repair route.
- `public/` — PWA manifest, service worker (`sw.js`), and generated icons.

## Invariants

- The barcode number written on the document is the truth — the full `(01)…(15)…(10)…` number visibly printed on the label supplies the expected GTIN, best-before, and lot; LOT CODE / BEST BEFORE text lines and a drawing's `descr` alt-text are fallbacks only, and text lines that disagree with the written number are flagged (`BEST_BEFORE_MISMATCH`, `LOT_MISMATCH`, `BARCODE_VALUE_MISMATCH`) and corrected by repair.
- Repair is surgical: it replaces only the barcode image inside the uploaded DOCX at its detected size and position, syncs the human-readable barcode number, and corrects LOT CODE / BEST BEFORE text when wrong. Title, ingredients, fonts, and every other element of the uploaded document stay untouched. Correction UI stays hidden for verified labels.
- Fix-and-Download-ALL bundles correct originals unchanged and repaired labels as `[FIXED] <name>` into `Labels.zip`.
- Encoded barcode data never contains parentheses; rendered barcodes have no human-readable digits beneath them.
- `sample/` DOCX files are read-only fixtures relied on by tests.
- Tests must stay green: worktree checkouts under `.kilo/` are excluded from vitest and eslint.
