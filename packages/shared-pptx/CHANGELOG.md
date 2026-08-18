# @json-to-office/shared-pptx

## 0.28.0

### Patch Changes

- Updated dependencies [a033a8b]
  - @json-to-office/shared@0.28.0

## 0.25.0

### Minor Changes

- 96c30b3: Capabilities needed to reproduce professionally designed Office templates.

  **PPTX** — `text.runs[]` for per-run styling and `lineSpacingMultiple` for
  percent line spacing; `shape.fill.gradient` (linear/radial) and
  `shape.fill.pattern` (OOXML preset hatches), both injected into slide XML at
  package time since pptxgenjs exposes neither; `shape.angleRange` for
  arc/pie/blockArc/chord plus `flipH`/`flipV`; chart passthrough for
  `dataBorder`, grid lines, axis label fonts and sizes, axis line visibility,
  marker size and bar overlap.

  **DOCX** — paragraph/heading `indent`; paragraph `tabStops` with leaders and
  literal tab runs; `font.scale` for glyph width; `font.size` now accepts up to
  120pt for display typography; and root `props.themeOverrides`, a partial theme
  deep-merged over the named theme so palette tokens, font roles and named styles
  can be defined in-document rather than in an external theme file. `boldColor`
  resolves theme tokens like every other color prop.

  DOCX also gains a single shared generation prologue, so the plain and
  plugin-aware entry points can no longer disagree about theme resolution.

### Patch Changes

- Updated dependencies [96c30b3]
  - @json-to-office/shared@0.25.0

## 0.24.0

### Patch Changes

- 5e6f5df: Say "component" everywhere; drop the last traces of the old `modules` format.

  The JSON tree has one node kind — `{ name, props, children? }` — in two
  flavours, base and custom. But an earlier format nested `modules` inside
  `modules`, and its vocabulary outlived it. The README and the architecture guide
  both opened by describing documents as "a tree of **modules**, each module
  containing base components", a hierarchy that no longer exists and that the code
  sample directly beneath contradicted. Schema descriptions called section
  header/footer arrays "modules", and a validation hint told authors to check
  their "module type" — a phrase they would find nowhere in the schema. All of
  these now say component, matching what the validator actually reports.

  Two dead things went with it. `DOC_LINKS` is **removed** from the
  `@json-to-office/shared-docx` public surface: it was consumed nowhere, and all
  three of its URLs pointed at a `json-to-docx.com` docs domain the project no
  longer uses. `core-docx`'s `examples/test-spacing-debug.ts` is deleted — it was
  written in the superseded `type`/`config`/`modules` shape, so it could not
  render against the current parser, yet still compiled as part of the package.

  The error-message change is behavioural, not just cosmetic: the generic
  union catch-all detector in both deep validators matched
  `/invalid (component|module) configurations?/`, and the union-array hint
  branched on `path?.includes('modules')`. No message producer has emitted
  "module" for some time and no path segment is named `modules`, so both branches
  were unreachable; they now match only what is actually emitted.

## 0.22.0

### Patch Changes

- Updated dependencies [e311268]
  - @json-to-office/shared@0.22.0

## 0.21.0

### Minor Changes

- 3e05df7: Make generation strict and deterministic by default, harden HTTP rendering,
  ship real schema exports, and migrate CLI output to Ink.

  Behaviour changes to expect when upgrading:

  - **The root component now requires a `props` key.** This aligns the runtime
    validator with the exported JSON Schema, which already marked `props` as
    required. Every field inside it stays optional, so documents that omitted it
    only need `"props": {}`.
  - **Custom component subtrees are now validated.** Standard components authored
    inside a plugin container must satisfy the same prop and tree contract they
    do elsewhere; previously the whole subtree was skipped.
  - **CLI errors go to stderr, and non-TTY output is plain.** Piped or redirected
    output no longer carries terminal escape sequences and is no longer wrapped
    to the terminal width. Use `-f json` for machine-readable results.
  - **Render server:** `resources.files` is rejected in safe mode (Highcharts
    loads it as JavaScript), export dimensions declared under `infile.exporting`
    are now capped, and any `NODE_ENV` other than `development` / `test` gets
    production-grade auth, rate-limit, and outbound-source defaults.

### Patch Changes

- Updated dependencies [3e05df7]
  - @json-to-office/shared@0.21.0

## 0.20.0

### Minor Changes

- bc15ebf: feat(pptx): real validation for `pptx validate` — deep, path-aware checking of whole presentations

  `jto pptx validate` previously returned valid unconditionally: unknown component names, dead props (e.g. `fontColor` on `text`), and malformed trees all passed. shared-pptx now ships a unified validation facade (`validate` / `validateStrict`) mirroring shared-docx: a deep walk validates every component's props against its registry schema with precise JSON-pointer paths, enforces container narrowing (`pptx` → `slide` → content), rejects children on leaf components and unknown top-level fields, validates slide `placeholders` values, checks image source mutual exclusivity, and validates themes against `ThemeConfigSchema`. The CLI wires both `pptx` document and theme validation to it, and a missing/broken validation module now reports an error instead of silently passing the file.

- de4d21c: feat(pptx): `props.theme` accepts an inline theme config object

  A presentation can now embed its theme directly (`props.theme: { name, colors, fonts, defaults, ... }`) instead of naming a built-in or `--theme-path` theme, keeping the document fully self-contained. Both generators normalize the inline object to a named customThemes entry, so font-mode scoping and name-keyed theme re-resolution work unchanged. Validation checks the inline object against `ThemeConfigSchema`.

## 0.19.0

### Minor Changes

- a332658: feat(docx,pptx): document-level default language with per-component overrides

  Documents and presentations can now declare a default proofing/spell-check language, with local overrides on the components where it makes sense.

  - **docx**: `props.language` (BCP-47, e.g. `"en-US"`) sets Word's document default via `docDefaults` (`w:docDefaults/w:rPrDefault/w:lang`). `paragraph` and `heading` gain a `language` override (emits a run-level `w:lang`) and a `noProof` toggle (emits `w:noProof`) to skip spell/grammar checking on code snippets, identifiers, etc. Runs without an override inherit the document default.
  - **docx `noProofWords`**: a "known words" allowlist on the document (`props.noProofWords`) — and per `paragraph`/`heading`, merged with the document list. Every whole-word, case-insensitive occurrence is split into its own `w:noProof` run so Word never flags it (brand names, technical terms), while the surrounding text stays spell-checked. A portable, document-embedded stand-in for a custom dictionary, since Word's real dictionaries can't be shipped inside a `.docx`. Applies across decorated text, hyperlinks and placeholders. (docx-only.)
  - **pptx**: `props.language` sets the default language for every text run (pptxgenjs `lang`), and `text` gains a `language` override. `noProof` is docx-only — PowerPoint's text runs don't expose a no-proof flag through pptxgenjs.

  Threaded through the shared schemas, the docx style/run pipeline (`createWordStyles`, `createText`, `createHeading`, the markdown/placeholder text-run builders) and the pptx slide context, so the language survives decorators, hyperlinks and placeholders.

## 0.18.0

### Minor Changes

- a079015: feat: forward `resources` from the highcharts component to the export server, and accept raw inline SVG markup as an image source (docx + pptx)

  **Highcharts `resources` (docx + pptx).** The `highcharts` component gains an optional `resources` prop (`{ css?, js?, files? }`) that is passed through verbatim to the Highcharts Export Server's `/export` payload. This unlocks the server's native `resources` contract — notably `@font-face` rules in `css` pointing at web-hosted `.woff2` files, so charts can render in custom fonts (e.g. Manrope, Carlito). Fully backward compatible: when `resources` is omitted the request body is byte-identical to before (no `resources` key sent). The object is forwarded as-is — no transform, re-serialize, or key stripping. In docx, `resources` is part of the component props, so it is already part of the render cache key — two charts differing only by `resources` are not deduped to the same image.

  **Inline SVG image source (docx + pptx).** The `image` component gains an `svg` prop alongside `path`/`base64`, so callers can drop raw `<svg>…</svg>` markup straight into the JSON instead of encoding it as a data URI or pointing at a file. Source precedence is `svg > base64 > path`; the markup is wrapped into an `image/svg+xml` data URI and flows through the existing pipeline. In docx it renders as a true vector (Word 2016+, with the usual PNG fallback) and honors width/height (intrinsic viewBox size when omitted), `%` widths, alignment, caption, floating, and table-cell placement; resolution is centralized in a shared `resolveImageSource()` helper used by every image render path (block, table cell, column layout), and document validation rejects an image that sets more than one of `path`/`base64`/`svg` with a path-aware error. In pptx the same `svg` source is embedded as a vector (PowerPoint 2016+, with pptxgenjs's PNG fallback) and participates in intrinsic-aspect auto-sizing (e.g. width-only → height derived from the viewBox) via the same precedence helper. Adds an `eldermoor-census` example custom component (docx) demonstrating how to expose structured data props and render them via the inline `svg` image source.

### Patch Changes

- 71faefc: fix(pptx): reject images that set more than one source (path/base64/svg)

  `path`, `base64`, and `svg` are mutually exclusive on the image component, but all three are optional fields on one object schema — so a multi-source payload passed the structural check and was silently resolved by runtime precedence. PPTX now collects these conflicts in an unconditional tree walk (`collectImageSourceConflicts`, mirroring core-docx) and fails generation with a `mutually_exclusive` error pointing at the offending component anywhere in the tree (slides, grids, containers, table cells). This brings pptx to full parity with docx, where the same conflict is already a hard error.

## 0.16.0

### Patch Changes

- Updated dependencies [95cc7c4]
  - @json-to-office/shared@0.16.0

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

- Updated dependencies [1db99a3]
  - @json-to-office/shared@0.2.0
