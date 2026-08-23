# @json-to-office/shared-pptx

## 1.0.0

### Minor Changes

- a05a152: Document JSON can now select its renderer with an optional top-level
  `renderer` discriminator. Omission selects `docxjs` for DOCX and `pptxgenjs`
  for PPTX. Generated schemas, runtime validation, autocomplete and exported
  renderer-profile types derive backend-specific branches from the canonical
  component schemas; compiler capability checks remain authoritative after custom
  component expansion and asset resolution.

  Runtime custom-component schemas are rebuilt from the current plugin
  definitions, so reloading the same component name and version cannot reuse stale
  props or child metadata.

### Patch Changes

- Updated dependencies [39b2ced]
- Updated dependencies [a05a152]
- Updated dependencies [d145c9c]
  - @json-to-office/shared@1.0.0

## 0.35.0

### Minor Changes

- 30d01dd: Make custom fonts work end to end, especially in hosted playgrounds.

  `props.fontRegistry` and a theme-level `fontRegistry` now actually resolve
  fonts. The field was documented in the schema and in the guide, but nothing
  read it: validation and `FontRegistry` saw only `options.fonts.extraEntries`,
  so a correctly declared non-safe family still warned `FONT_UNRESOLVED` and
  previews fell back to a host font. Precedence is theme < document < runtime. A
  registry is treated as a declaration rather than a set of references, so its
  entries no longer self-satisfy validation and `substitute` mode no longer
  renames a registration onto a SAFE_FONTS name.

  Font warnings now reach the caller. They were collected in core and then
  dropped at the `FormatAdapter` seam, because `emitGenerationWarnings` routes to
  a diagnostics sink that is a no-op outside an interactive CLI task. Generation
  warnings are also cached alongside the buffer, so they survive a repeat render
  of the same document. `jto pptx generate` previously printed no core warnings
  at all; it now does.

  The playground gained a **Custom** font tab: upload a TTF/OTF, or embed any
  Google family through the materialize endpoint. Both become self-contained
  `kind: "data"` registry entries, so the font travels with the JSON. The fast
  in-browser preview now synthesizes an `@font-face` block from the registry,
  including rules for the synthetic sub-family names that intermediate weights
  are written as, so a `fontWeight: 300` run no longer renders as Regular.

  Docx `visual` components are rasterized to PNG by an out-of-process
  LibreOffice, which previously received no font bytes and so rendered every
  custom family in a fallback. Resolved fonts are now forwarded to the
  rasterizer and staged around its `soffice` launch, and the rasterizer's
  content-addressed cache key absorbs a font digest — without that, a shared
  render server would serve one document's fontless PNG to another.

  Also: Geist, Geist Mono, Space Grotesk and Archivo joined the bundled Google
  catalog, and the shipped templates stopped hand-authoring synthesized family
  names like `"Geist Light"` — a shape the renderer emits, never one it accepts.

  **Behaviour change:** generating a document that contains a `visual` now
  materializes fonts (including Google Fonts network fetches) even with no
  preview listener attached, because the rasterizer needs real font files.
  Documents without a `visual` are unaffected.

  **Deploy ordering:** ship `jto-render-server` before the playground. Both
  rasterize schemas are `additionalProperties: false`, so a `fonts`-bearing body
  reaches an old server as a 400 rather than being ignored. The batch path
  retries once without fonts, but ordering avoids the wasted round trip.

  PPTX chart labels and table defaults can now carry a font weight. The five
  chart font-face props (`titleFontFace`, `legendFontFace`, `dataLabelFontFace`,
  `catAxisLabelFontFace`, `valAxisLabelFontFace`) each gained a `*FontWeight`
  companion, and `TablePropsSchema` gained a table-level `fontWeight` next to its
  table-level `fontFace`. Both run through the same `synthesizeFamilyName` seam a
  run-level `fontFace`/`fontWeight` pair does, so `{ dataLabelFontFace: "Inter",
dataLabelFontWeight: 300 }` renders as the `Inter Light` face. Previously the
  only weight-ish companion in the chart schema was the boolean
  `dataLabelFontBold`, and tables had a weight per cell but none at table level —
  so nine sites across the shipped decks rendered Regular where the design said
  Light or Medium. Those weights are restored. The legend is the one slot
  PowerPoint gives no bold toggle: `legendFontWeight: 700` renders Regular and
  emits a new `CHART_FONT_WEIGHT_DROPPED` warning.

  **Rasterizer font-cache keys change.** `fontsDigest` now hashes the decoded
  font bytes rather than the base64 text, matching its own documented
  content-addressed contract — three spellings of the same bytes (padded,
  unpadded, newline-wrapped) previously staged identical fonts under three keys.
  Existing font-bearing entries in the rasterizer's disk cache become unreachable
  orphans; fontless entries keep byte-identical keys and are unaffected.

  **`/rasterize` now rejects malformed font data.** `RasterizeFontFaceSchema.data`
  is held to a strict base64 pattern instead of relying on `Buffer.from`, which
  silently tolerates whitespace, `data:` prefixes and invalid characters and so
  let garbage reach LibreOffice. Third-party clients sending MIME-wrapped or
  `data:`-prefixed base64 now get a 400; in-repo producers are unaffected, and
  the docx side already retries without fonts when a server 400s. The route also
  honours the configured body limit instead of a hardcoded 32 MiB, clamped to a
  64 MiB ceiling.

  **WOFF/WOFF2 faces are no longer forwarded to the rasterizer.** Every stager
  renames a face via `rewriteFontFamilyName`, which returns non-sfnt input
  unchanged — so a web font was either unparseable or indexed under the wrong
  family, and rendered as a silent fallback either way. Only `ttf`/`otf` are sent
  now, via an allowlist so a newly added format stays excluded until a stager
  supports it.

  A face the rasterizer's stagers cannot register (WOFF/WOFF2) now produces a
  `FONT_FORMAT_NOT_RASTERIZABLE` generation warning instead of being dropped
  silently. The drop itself is correct — those formats never rendered — but a
  visual falling back to a system face without saying so is the exact silent
  substitution this work exists to eliminate.

### Patch Changes

- Updated dependencies [30d01dd]
  - @json-to-office/shared@0.35.0

## 0.33.0

### Patch Changes

- 2ae9268: Exported component unions are now canonical if/then discriminated unions —
  fixing both component-name autocomplete and union diagnostics.

  Monaco / VS Code resolve a partially-typed node against a flat `anyOf` by
  keeping the single best-matching branch. While typing `{ "name": | }`, every
  branch requiring `props` failed validation, so its name never reached
  autocomplete (a section's children suggested only `image`, `text-box`, `toc`),
  and diagnostics reported one arbitrary branch's complaints — `Missing property
"props"` plus `Value must be "heading"` — instead of the real problem.

  `restructureNameDiscriminatedUnions` (new export from `@json-to-office/shared`,
  applied inside both `convertToJsonSchema` implementations, JSON-Schema export
  only — runtime TypeBox validation is untouched) rewrites each
  name-discriminated union into `properties.name` (the discriminator enum, with
  per-component descriptions) plus `allOf[].if/then` dispatch. The accepted
  document set is exactly the same — verified by parity tests and ajv over all
  shipped templates — but editors now behave deterministically:

  - completing `name` offers every legal component, with its description
  - an empty component reports only `Missing property "name"`
  - an empty or wrong name reports only `Value is not accepted. Valid values: …`
  - a valid name activates exactly its branch for keys, props and errors

  `unionBranches` (also exported) iterates branch objects shape-agnostically for
  consumers that post-process them. Standard component branches additionally
  carry their registry `description`. Versioned plugin branches stay grouped in
  a small `anyOf` inside their `then`.

  Plugin toggles also round-trip exactly: the playground sends its selection as
  an explicit `plugins=` query (empty means "no plugins") and the discovery
  endpoint honors it, instead of treating an empty selection as "all registered
  plugins". Only a missing param still falls back to everything.

- Updated dependencies [2ae9268]
  - @json-to-office/shared@0.33.0

## 0.32.0

### Minor Changes

- 0b021e5: PPTX slides accept `meta.title` — an authoring-only label, symmetric to the
  DOCX section `meta.title`: never rendered (generated .pptx is byte-identical
  with or without it), surfaced by editors and the playground outline as the
  slide's label.

  The outline's derived slide labels also got smarter for documents without
  explicit labels: template-driven slides now read their `title`/`subtitle`
  placeholders (previously such decks labeled as "Slide N"), and multi-line
  titles are joined onto one line instead of truncating at the first line
  break. All stock pptx templates ship with curated `meta.title` labels where
  the derived label was weak or duplicated.

## 0.29.0

### Patch Changes

- Updated dependencies [b536bb6]
  - @json-to-office/shared@0.29.0

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
