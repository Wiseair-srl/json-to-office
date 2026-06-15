# @json-to-office/shared-docx

## 0.17.0

### Minor Changes

- 542f8ad: fix(docx): surface invalid props on generation instead of silently dropping them

  Closes a correctness gap where the object/buffer generation path accepted malformed input and emitted a silently-wrong document. A typo'd prop such as `lineSpacing: { name: 'single' }` (should be `{ type: 'single' }`) used to be quietly discarded, shipping a document with the property missing. Generation now validates by default — the same check the playground already performs — and reports the error instead of producing corrupt output.

  - **Validation on generation (default on).** `generateDocumentFromJson` / `generateBufferFromJson` validate both string and object input and throw `JsonValidationError` on invalid documents. The plugin generator (`createDocumentGenerator().generate/generateBuffer/generateFile`) validates plugin-aware (standard + registered custom components) and throws `ComponentValidationError`. Need the old pass-through behavior? Set `validation: { enabled: false }`.
  - **Clearer messages for typo'd keys.** Component prop objects reject unknown properties, so a misspelled key surfaces as `Unexpected property "<key>"` rather than being ignored. Highcharts `options` stays an open passthrough.
  - **`allowUnknownFields` opt-out.** `validation: { allowUnknownFields: true }` strips unknown properties instead of rejecting them — a one-line migration aid for documents carrying stray keys. Required and typed fields are still enforced.
  - **Plugin validation fixes.** The plugin generator previously computed validation and discarded the result (so it never reported anything), and `generator.validate()` always returned `{ valid: true }`. Both now work, and registered custom components are no longer mistakenly rejected.

  The playground JSON Schema and the runtime validator both derive from the same TypeBox definitions, so they stay in sync. If a document relied on invalid props being silently dropped, pass `validation: { allowUnknownFields: true }` (strip unknown keys) or `validation: { enabled: false }` (skip validation) to keep the prior behavior.

## 0.16.0

### Minor Changes

- 95cc7c4: feat(docx): `visual` component — embed pptx-rendered graphics as PNGs

  Author a free-canvas graphic as a single pptx slide directly inside a
  `.docx.json` document; it is rasterized to a PNG at build time and embedded as
  an image. Unlocks absolute positioning, overlapping shapes and layered art
  (infographics, diagrams, hero compositions) that the docx flow layout cannot
  express — while the visual stays plain, diffable, deterministic JSON.

  Mirrors the `highcharts` pattern: the component offloads rendering to an
  injected service (`services.pptx`) and desugars to a plain `image`. The
  published engine packages stay pure JS — no binary dependency.

  - New `visual` standard component (`canvas` + pptx `elements`, plus
    image-style placement props: `width`, `alignment`, `caption`, `spacing`,
    `floating`). Allowed inside `section` and `columns`.
  - First-class validation: `elements` are validated against the real PPTX
    slide-content union (`PptxSlideContentSchema`, new in
    `@json-to-office/shared-pptx`) — same authoring fidelity as a standalone
    `.pptx.json`, with full Monaco autocomplete. Hoisted into a single
    `PptxSlideContent` JSON-Schema definition (no per-use inlining).
  - New `services.pptx` config (`PptxServiceConfig`): inject an in-process
    `render` callback or an HTTP `serverUrl`; per-component `dpi`/`serverUrl`
    overrides.
  - `createLibreOfficePptxRasterizer()` (from `@json-to-office/jto-cli`):
    pptx → (LibreOffice) PDF → (poppler `pdftoppm`) PNG, with a content-addressed
    on-disk cache. Wired into the `jto` CLI/server docx path automatically; point
    at a remote rasterizer with `JTO_PPTX_RASTERIZER_URL`.
  - `flattenVisuals(doc, { rasterize, dpi })` (re-exported from
    `@json-to-office/json-to-docx`): desugar every `visual` → `image{base64}`
    ahead of time, producing a portable document that builds with no service
    configured.
  - `POST /api/pptx/rasterize` on the `jto` server: `{ presentation, dpi }` →
    `{ base64DataUri, width, height }`, the HTTP backend for `services.pptx.serverUrl`.
  - `jto-render-server` — a standalone combined server (`packages/jto/dist/render-server.js`)
    that serves `POST /rasterize` and reverse-proxies everything else to a
    co-located Highcharts Export Server, so one Render instance backs both
    `services.highcharts` and `services.pptx`. Deployed via the renamed
    `services/jto-render-server` image (Chromium + LibreOffice + poppler).
  - Example: `examples/visual-infographic.docx.json`.

  Robustness:

  - Visuals render and flatten in every position — section/column children,
    section headers/footers, and table cells/headers — not just top-level
    children. `flattenVisuals` rasterizes with bounded concurrency and skips
    disabled visuals.
  - DPI policy is centralized (`DEFAULT/MIN/MAX_VISUAL_DPI`, range 36–600) and
    enforced everywhere; the public `/rasterize` shares one validated handler
    (body-size limit, rate limit, dpi clamp) with the in-app route.
  - The combined server's `/health` reflects the highcharts upstream's readiness;
    proxy and rasterize fetches have timeouts; the entrypoint supervises (restarts)
    highcharts. The rasterizer cache writes atomically and validates PNGs (no
    truncated/0×0 images), and binary resolution is memoized.

### Patch Changes

- Updated dependencies [95cc7c4]
  - @json-to-office/shared@0.16.0
  - @json-to-office/shared-pptx@0.16.0

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

## 0.13.1

### Patch Changes

- 938bdda: fix(validate): recognize `docx` (and any registered root) in deep validator

  The CLI `validate` command emitted false-negatives — `root: Invalid component
configuration for 'docx'` plus `/name: Unknown component "docx"` — on documents
  that `generate` accepts cleanly. The deep validator's component-schema lookup
  was hardcoded with a stale `report` entry and no `docx` entry, so the root
  `name: "docx"` was reported as unknown.

  The lookup table now comes from `STANDARD_COMPONENTS_REGISTRY` (the single
  source of truth), and the comprehensive validator strips TypeBox's generic
  discriminated-union catch-all so it never appears alongside the precise,
  path-aware diagnostics the deep validator already produces.

## 0.13.0

### Patch Changes

- Updated dependencies [8744ad2]
  - @json-to-office/shared@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [c4a57aa]
  - @json-to-office/shared@0.12.0

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

## 0.8.0

### Minor Changes

- b1af6ef: Centralize component-defaults resolution into a single tree walk (`resolveComponentTree`) before rendering, removing per-component resolve calls from individual renderers. Support document-level `componentDefaults` override in report/presentation props. Extract shared `deepMerge` utility.

### Patch Changes

- Updated dependencies [b1af6ef]
  - @json-to-office/shared@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [c0bd927]
  - @json-to-office/shared@0.7.0

## 0.6.0

### Minor Changes

- 84299d3: Remove placeholder header/footer component types and exports. Centralize image type detection and ImageRun construction. Support percentage strings (e.g., "50%") for floating position offsets and wrap margins, resolved against page or available dimensions. Fix table cell backgroundColor defaulting to transparent when unset.

## 0.5.3

### Patch Changes

- a89a7cc: feat: use Monaco built-in JSON schema validation for theme editor

  Replace custom `validateThemeJson` marker-setting with Monaco's native `onValidate`, add ValidationPanel/StatusBar UI, and tighten theme schemas with `additionalProperties: false`.

## 0.3.0

### Minor Changes

- de674e0: feat(schema): per-container narrowed children validation for DOCX and PPTX

  Each container component now declares its `allowedChildren`, and the schema
  generator builds per-container children unions instead of one flat recursive
  union. Monaco immediately flags invalid nesting (e.g. heading inside docx).

  Also skips auto-builds when JSON is syntactically invalid or has schema
  validation errors, preventing wasted server roundtrips during typing.

## 0.2.0

### Patch Changes

- 1db99a3: Extract shared plugin infrastructure from core-docx into shared package and add plugin system for PPTX generation
- Updated dependencies [1db99a3]
  - @json-to-office/shared@0.2.0

## 0.1.2

### Patch Changes

- 4c7fadd: Fix docx dependency version: 9.0.4 doesn't exist on npm, aligned to 9.5.1

## 0.1.1

### Patch Changes

- 8175b59: Fix docx dependency version: 9.0.4 doesn't exist on npm, aligned to 9.5.1
