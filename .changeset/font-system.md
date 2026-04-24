---
'@json-to-office/shared': minor
'@json-to-office/shared-docx': minor
'@json-to-office/shared-pptx': minor
'@json-to-office/core-docx': minor
'@json-to-office/core-pptx': minor
'@json-to-office/jto': minor
---

Font system across the stack.

- **shared**: font catalog, registry, and resolver with Google / URL / file / data / variable sources; font validation; substitution tables.
- **core-docx / core-pptx**: new `fonts` generator option with `custom` (default, keeps references as-is) and `substitute` (rewrites non-safe families to safe equivalents) export modes. Optional `strict` flag throws on unresolved non-safe references. Font-weight synthesis via `fontFace` / `bold` / `fontWeight` aliasing.
- **shared-docx / shared-pptx**: new optional font fields on text / shape / table / theme schemas (backward compatible).
- **jto CLI**: `--font`, `--fonts-dir` flags and a `fonts` subcommand.
- **jto server**: `/api/fonts` catalog, auto-Google resolution, per-platform font staging (macOS / Windows / fontconfig) for LibreOffice preview.
- **jto client**: font picker dialog (Safe / Google / Uploads), Monaco CodeLens for font fields, live `@font-face` injection in the playground preview.
