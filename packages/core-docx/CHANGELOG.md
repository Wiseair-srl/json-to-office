# @json-to-office/core-docx

## 0.14.0

### Minor Changes

- afe9789: feat(docx): tracked-change document diff

  Diff two docx JSON definitions into a redline rendered as native Word tracked
  changes (accept/reject, author, timestamp; opens in review mode).

  - New `revision` prop on `paragraph`/`heading`/`list` items and a
    `trackRevisions` root prop, rendered as `w:ins`/`w:del`.
  - `diffDocuments(oldDoc, newDoc)` (word-level diff, block alignment, fidelity
    summary), re-exported from `@json-to-office/json-to-docx`.
  - CLI: `jto docx diff <old> <new> -o redline.docx`.
  - Playground: `POST /api/docx/diff` endpoint and a Compare dialog that opens
    the redline as a normal document with live preview.

### Patch Changes

- 8916aaa: fix(docx): built-in minimal/modern themes used "SF Mono" for the mono font,
  which is not a SAFE_FONTS entry — every render logged FONT_UNRESOLVED and fell
  back to a host font. Switched to Menlo (safe, closest match) so built-in
  themes render warning-free out of the box.
- Updated dependencies [afe9789]
  - @json-to-office/shared-docx@0.14.0

## 0.13.0

### Minor Changes

- 8744ad2: feat(core-docx): per-call `preserveCustomComponents` option on `generate` / `generateBuffer` / `generateFile`. Listed component names are kept verbatim (un-expanded) in a new `preservedDefinition` field on the result; `standardDefinition` and the rendered DOCX are unchanged. `generateFile` also writes a JSON sidecar (default `<out>-preserved.json`, override via `preservedOutputPath`). Unknown names throw `UnknownPreservedComponentError` (exported from `@json-to-office/shared` and `@json-to-office/core-docx`).
- 755d812: feat(core-docx): surface `standardDefinition` from `generate` / `generateBuffer` / `generateFile` — the post-expansion JSON tree (custom plugins resolved) is returned alongside the document/buffer at no extra cost. Plugin `render()` previously ran twice when callers used the standalone inspection method together with a generate call, duplicating side effects (e.g. external API hits).

  `getStandardComponentsDefinition` is **deprecated** and now implemented as a thin wrapper around `generate(...).standardDefinition`. Existing callers keep working; migrate by reading `standardDefinition` directly off any `generate*` result. The method will be removed in a future major.

### Patch Changes

- Updated dependencies [8744ad2]
  - @json-to-office/shared@0.13.0
  - @json-to-office/shared-docx@0.13.0

## 0.12.0

### Minor Changes

- c4a57aa: feat(highcharts): allow `services.highcharts.headers` to be a function of the request body, enabling per-request signing/auth derived from payload. Adds `HighchartsHeaders` and `HighchartsHeadersResolver` exports from `@json-to-office/shared`. Static-object form remains supported.

### Patch Changes

- c4a57aa: chore: drop highcharts-export-server peerDependency — server is only called over HTTP, no runtime import; removes install-time approve-build warning for consumers
- Updated dependencies [c4a57aa]
  - @json-to-office/shared@0.12.0
  - @json-to-office/shared-docx@0.12.0

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
  - @json-to-office/shared-docx@0.9.0

## 0.8.0

### Minor Changes

- b1af6ef: Centralize component-defaults resolution into a single tree walk (`resolveComponentTree`) before rendering, removing per-component resolve calls from individual renderers. Support document-level `componentDefaults` override in report/presentation props. Extract shared `deepMerge` utility.

### Patch Changes

- Updated dependencies [b1af6ef]
  - @json-to-office/shared-docx@0.8.0
  - @json-to-office/shared@0.8.0

## 0.7.0

### Minor Changes

- c0bd927: Add generator-level services config for Highcharts export server endpoint and auth headers

### Patch Changes

- Updated dependencies [c0bd927]
  - @json-to-office/shared@0.7.0
  - @json-to-office/shared-docx@0.7.0

## 0.6.0

### Minor Changes

- 84299d3: Remove placeholder header/footer component types and exports. Centralize image type detection and ImageRun construction. Support percentage strings (e.g., "50%") for floating position offsets and wrap margins, resolved against page or available dimensions. Fix table cell backgroundColor defaulting to transparent when unset.

### Patch Changes

- Updated dependencies [84299d3]
  - @json-to-office/shared-docx@0.6.0

## 0.5.0

### Minor Changes

- b34970d: feat: upgrade JSON template examples to Wiseair-level quality

  - Rewrite proposal (apex theme), technical-guide (devportal theme), invoice (modern table styling)
  - Replace Charts Demo with Lumina Analytics deck (39K, 15 slides, all native chart types, grid + templates + decorative shapes)
  - Rewrite pitch-deck as Meridian Series B (29K, 9 slides, grid + templates + decorative shapes)
  - Add 4 custom themes: apex, devportal (DOCX), lumina, meridian (PPTX)
  - Modern table styling: hide vertical inside borders, cell padding, headerCellDefaults
  - Delete 7 low-quality templates: Sales Deck, Company Branding, Product Launch, Dashboard, Charts Demo, quarterly-report, annual-review
  - Remove quarterlyReportExample export from core-docx

## 0.3.1

### Patch Changes

- 3ce62dd: Use theme option as fallback in resolveDocumentTheme, fixing regressions for users migrating from @wiseair-srl/json-to-docx

## 0.3.0

### Patch Changes

- Updated dependencies [de674e0]
  - @json-to-office/shared-docx@0.3.0

## 0.2.0

### Patch Changes

- 1db99a3: Extract shared plugin infrastructure from core-docx into shared package and add plugin system for PPTX generation
- Updated dependencies [1db99a3]
  - @json-to-office/shared@0.2.0
  - @json-to-office/shared-docx@0.2.0
