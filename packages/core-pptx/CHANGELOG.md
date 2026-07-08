# @json-to-office/core-pptx

## 0.20.0

### Minor Changes

- f708776: feat(docx,pptx): highcharts charts follow the document theme by default

  The `highcharts` component forwarded its config verbatim, so charts with no explicit `colors` rendered in the Highcharts default palette (blue-first) regardless of theme. When `options.colors` is absent, the renderer now injects the theme palette — pptx uses the same token list as the native `chart` component (primary, secondary, accent, accent4-6); docx uses primary/secondary/accent. Explicit `colors` always wins, so existing configs that set colors are unchanged.

### Patch Changes

- Updated dependencies [9bf85dd]
  - @json-to-office/shared-pptx@0.20.0

## 0.19.0

### Minor Changes

- a332658: feat(docx,pptx): document-level default language with per-component overrides

  Documents and presentations can now declare a default proofing/spell-check language, with local overrides on the components where it makes sense.

  - **docx**: `props.language` (BCP-47, e.g. `"en-US"`) sets Word's document default via `docDefaults` (`w:docDefaults/w:rPrDefault/w:lang`). `paragraph` and `heading` gain a `language` override (emits a run-level `w:lang`) and a `noProof` toggle (emits `w:noProof`) to skip spell/grammar checking on code snippets, identifiers, etc. Runs without an override inherit the document default.
  - **docx `noProofWords`**: a "known words" allowlist on the document (`props.noProofWords`) — and per `paragraph`/`heading`, merged with the document list. Every whole-word, case-insensitive occurrence is split into its own `w:noProof` run so Word never flags it (brand names, technical terms), while the surrounding text stays spell-checked. A portable, document-embedded stand-in for a custom dictionary, since Word's real dictionaries can't be shipped inside a `.docx`. Applies across decorated text, hyperlinks and placeholders. (docx-only.)
  - **pptx**: `props.language` sets the default language for every text run (pptxgenjs `lang`), and `text` gains a `language` override. `noProof` is docx-only — PowerPoint's text runs don't expose a no-proof flag through pptxgenjs.

  Threaded through the shared schemas, the docx style/run pipeline (`createWordStyles`, `createText`, `createHeading`, the markdown/placeholder text-run builders) and the pptx slide context, so the language survives decorators, hyperlinks and placeholders.

### Patch Changes

- Updated dependencies [a332658]
  - @json-to-office/shared-pptx@0.19.0

## 0.18.0

### Minor Changes

- a079015: feat: forward `resources` from the highcharts component to the export server, and accept raw inline SVG markup as an image source (docx + pptx)

  **Highcharts `resources` (docx + pptx).** The `highcharts` component gains an optional `resources` prop (`{ css?, js?, files? }`) that is passed through verbatim to the Highcharts Export Server's `/export` payload. This unlocks the server's native `resources` contract — notably `@font-face` rules in `css` pointing at web-hosted `.woff2` files, so charts can render in custom fonts (e.g. Manrope, Carlito). Fully backward compatible: when `resources` is omitted the request body is byte-identical to before (no `resources` key sent). The object is forwarded as-is — no transform, re-serialize, or key stripping. In docx, `resources` is part of the component props, so it is already part of the render cache key — two charts differing only by `resources` are not deduped to the same image.

  **Inline SVG image source (docx + pptx).** The `image` component gains an `svg` prop alongside `path`/`base64`, so callers can drop raw `<svg>…</svg>` markup straight into the JSON instead of encoding it as a data URI or pointing at a file. Source precedence is `svg > base64 > path`; the markup is wrapped into an `image/svg+xml` data URI and flows through the existing pipeline. In docx it renders as a true vector (Word 2016+, with the usual PNG fallback) and honors width/height (intrinsic viewBox size when omitted), `%` widths, alignment, caption, floating, and table-cell placement; resolution is centralized in a shared `resolveImageSource()` helper used by every image render path (block, table cell, column layout), and document validation rejects an image that sets more than one of `path`/`base64`/`svg` with a path-aware error. In pptx the same `svg` source is embedded as a vector (PowerPoint 2016+, with pptxgenjs's PNG fallback) and participates in intrinsic-aspect auto-sizing (e.g. width-only → height derived from the viewBox) via the same precedence helper. Adds an `eldermoor-census` example custom component (docx) demonstrating how to expose structured data props and render them via the inline `svg` image source.

### Patch Changes

- 71faefc: fix(pptx): reject images that set more than one source (path/base64/svg)

  `path`, `base64`, and `svg` are mutually exclusive on the image component, but all three are optional fields on one object schema — so a multi-source payload passed the structural check and was silently resolved by runtime precedence. PPTX now collects these conflicts in an unconditional tree walk (`collectImageSourceConflicts`, mirroring core-docx) and fails generation with a `mutually_exclusive` error pointing at the offending component anywhere in the tree (slides, grids, containers, table cells). This brings pptx to full parity with docx, where the same conflict is already a hard error.

- Updated dependencies [a079015]
- Updated dependencies [71faefc]
  - @json-to-office/shared-pptx@0.18.0

## 0.16.0

### Patch Changes

- Updated dependencies [95cc7c4]
  - @json-to-office/shared@0.16.0
  - @json-to-office/shared-pptx@0.16.0

## 0.13.0

### Patch Changes

- Updated dependencies [8744ad2]
  - @json-to-office/shared@0.13.0
  - @json-to-office/shared-pptx@0.13.0

## 0.12.0

### Minor Changes

- c4a57aa: feat(highcharts): allow `services.highcharts.headers` to be a function of the request body, enabling per-request signing/auth derived from payload. Adds `HighchartsHeaders` and `HighchartsHeadersResolver` exports from `@json-to-office/shared`. Static-object form remains supported.

### Patch Changes

- Updated dependencies [c4a57aa]
  - @json-to-office/shared@0.12.0
  - @json-to-office/shared-pptx@0.12.0

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
