# @json-to-office/core-pptx

## 0.11.1

### Patch Changes

- ef6950d: fix(core-pptx): plugin path now honors `props.theme` over constructor default

  Plugin-aware presentation generator unconditionally used a constructor-supplied `state.theme` object, shadowing `customThemes[doc.props.theme]`. Playground sessions with any plugin loaded rendered docs with the wrong theme (e.g. `props.theme: "wiseair"` falling back to `themes.minimal`). Resolution now mirrors the non-plugin path and the DOCX side: doc-level theme name wins, customThemes is consulted first, constructor `state.theme` is the fallback only.

## 0.9.0

### Minor Changes

- 58c0fb6: Font system across the stack.

  - **shared**: font catalog, registry, and resolver with Google / URL / file / data / variable sources; font validation; substitution tables.
  - **core-docx / core-pptx**: new `fonts` generator option with `custom` (default, keeps references as-is) and `substitute` (rewrites non-safe families to safe equivalents) export modes. Optional `strict` flag throws on unresolved non-safe references. Font-weight synthesis via `fontFace` / `bold` / `fontWeight` aliasing.
  - **shared-docx / shared-pptx**: new optional font fields on text / shape / table / theme schemas (backward compatible).
  - **jto CLI**: `--font`, `--fonts-dir` flags and a `fonts` subcommand.
  - **jto server**: `/api/fonts` catalog, auto-Google resolution, per-platform font staging (macOS / Windows / fontconfig) for LibreOffice preview.
  - **jto client**: font picker dialog (Safe / Google / Uploads), Monaco CodeLens for font fields, live `@font-face` injection in the playground preview.

### Patch Changes

- Updated dependencies [58c0fb6]
  - @json-to-office/shared@0.9.0
  - @json-to-office/shared-pptx@0.9.0

## 0.8.4

### Patch Changes

- 5ff0526: Skip image probe when not needed (both w/h set, no contain/cover); guard NaN/negative dimension values; warn on zero-sized sizing box; consolidate slide render context into single param

## 0.8.0

### Minor Changes

- b1af6ef: Centralize component-defaults resolution into a single tree walk (`resolveComponentTree`) before rendering, removing per-component resolve calls from individual renderers. Support document-level `componentDefaults` override in report/presentation props. Extract shared `deepMerge` utility.

### Patch Changes

- Updated dependencies [b1af6ef]
  - @json-to-office/shared-pptx@0.8.0
  - @json-to-office/shared@0.8.0

## 0.7.0

### Minor Changes

- c0bd927: Add generator-level services config for Highcharts export server endpoint and auth headers

### Patch Changes

- Updated dependencies [c0bd927]
  - @json-to-office/shared@0.7.0
  - @json-to-office/shared-pptx@0.7.0

## 0.3.0

### Patch Changes

- Updated dependencies [de674e0]
  - @json-to-office/shared-pptx@0.3.0

## 0.2.0

### Minor Changes

- 1db99a3: Extract shared plugin infrastructure from core-docx into shared package and add plugin system for PPTX generation

### Patch Changes

- Updated dependencies [1db99a3]
  - @json-to-office/shared@0.2.0
  - @json-to-office/shared-pptx@0.2.0
