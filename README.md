# Label Tag Generator

Project planning and implementation guidance:

- [PLAN.md](PLAN.md): phased product, architecture, security, testing, and deployment plan.
- [agents.md](agents.md): shared instructions for Claude Code and other coding agents.
- [SPEC.md](SPEC.md): original product specification.
- `sample/`: read-only DOCX reference fixtures.

## Current implementation

The first working slice is available:

- Create and inspect workbench UI with responsive desktop/mobile layout.
- GS1/GTIN normalization, check-digit validation, and AI payload parsing.
- Safe DOCX fixture inspection for page geometry, text boxes, relationships, and images.
- Server-side GS1-128 PNG generation with human-readable barcode text disabled.
- Server-side 6x4 DOCX generation and browser download.

The repair/scanning pipeline still needs the confirmed client symbology and scanner behavior described in [PLAN.md](PLAN.md).

## Commands

```bash
npm install
npm run dev
npm test
npm run lint
npm run build
```