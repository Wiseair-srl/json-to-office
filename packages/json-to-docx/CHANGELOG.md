# @json-to-office/json-to-docx

## 3.0.0

### Patch Changes

- Updated dependencies [1812512]
- Updated dependencies [4807d5d]
- Updated dependencies [7143379]
  - @json-to-office/shared@3.0.0
  - @json-to-office/shared-docx@3.0.0
  - @json-to-office/core-docx@3.0.0

## 2.0.0

### Patch Changes

- Updated dependencies [2d1a10b]
  - @json-to-office/core-docx@2.0.0
  - @json-to-office/shared-docx@2.0.0

## 1.1.0

### Minor Changes

- 9dbf86b: A DOCX `visual` can now be drawn natively, as a Word drawing group

  **New**

  `visual.props.renderMode: "native"`, on a document with
  `"renderer": "office-open"`, draws the canvas as one DrawingML group
  (`wpg:wgp`) instead of rasterizing it: shapes become `wps:wsp` preset
  geometry, text becomes real text boxes, and images become native pictures with
  SVGs kept vector. The text stays searchable and every object stays editable in
  Word, output for text- and shape-heavy graphics is smaller, and no PPTX, PNG or
  rasterization service is involved anywhere in the path — a document whose
  visuals are all native generates with `services` omitted entirely.

  Placement is unchanged from the raster form: `width`, `height`, `alignment`,
  `caption`, `alt`, `spacing`, `floating`, `keepNext` and `keepLines` all behave
  as they do for an image, and captions remain ordinary paragraphs outside the
  drawing. Geometry is inches or a percentage of the canvas; array order is
  z-order; a canvas background colour or image becomes the bottom-most object.

  Native mode is deliberately strict. Its element model is `text`, `shape` and
  `image`, and every native props schema rejects unknown properties, so a
  gradient fill, a `chart` element or a `dpi` that could not take effect is a
  validation error naming the exact path rather than a silently missing object.
  `renderMode: "native"` under any other renderer is reported at the component's
  own `props/renderMode`, and the compiler's new `drawing-groups` capability
  means IR that reaches `docxjs` by another route is refused before any bytes
  exist instead of losing the graphic.

  `docxPropsSchemaForRenderer` now takes the component name, so exported schemas
  and editor autocomplete offer the raster shape alone under `docxjs` and both
  shapes under `office-open`.

  **Fixed**

  Deep validation now resolves a union props schema to the branch the author
  wrote against, so a bad property inside `visual.props.elements[2]` is reported
  there rather than collapsing into one generic failure at `props`.

  Both `visual.props` shapes are hoisted into their own JSON-Schema definitions
  instead of being inlined at every position a component can appear. `visual` is
  the largest props schema in the registry, and inlining a second one pushed the
  exported `ComponentDefinition` deep enough that Ajv overflowed compiling it —
  so `jto docx validate --schema` failed on any document with a `visual` in a
  section header, footer or table cell, raster ones included. The exported schema
  is now smaller than before this change.

  **Unchanged**

  An omitted `renderMode` still means `raster`, and every existing document
  renders byte-for-byte as before.

### Patch Changes

- Updated dependencies [9dbf86b]
- Updated dependencies [9520fa3]
- Updated dependencies [fdf9c51]
  - @json-to-office/shared-docx@1.1.0
  - @json-to-office/core-docx@1.1.0
  - @json-to-office/shared@1.1.0

## 1.0.0

### Major Changes

- 767552d: DOCX generation now compiles to a renderer-neutral intermediate representation

  Documents are compiled to `DocxIR` — plain, serialisable data describing a
  finished document in Word terms — and a renderer adapter turns that into bytes.
  docx.js is now one backend behind that seam rather than the pipeline itself,
  which is the same shape the PPTX half already had.

  **Output is unchanged.** Every case in the parity corpus produces an identical
  package, part for part, checked against digests recorded from the previous
  implementation (`src/__tests__/corpus-ir-parity.test.ts`).

  **New**

  - `renderer` option on every DOCX generation entry point and on the plugin
    generator: `'docxjs'` (default) or `'office-open'` (experimental, opt-in). An
    unsupported feature fails before any bytes are produced, with the feature name
    and the IR path that needed it.
  - An experimental `@office-open/docx` backend, declared as an optional peer
    dependency. It covers paragraphs, styles, numbering, sections, columns,
    headers and footers, tables, floating tables, inline and floating images, SVG
    with a raster fallback, text boxes, text frames, footnotes, endnotes,
    comments, revisions, fields, bookmarks, cross-references and a table of
    contents with cached entries. Threaded or resolved comments are a verified gap
    — the backend's comment options carry neither a parent nor a resolved state —
    and are rejected up front rather than flattened.
  - `DEFAULT_DOCX_RENDERER_ID`, `docxRendererIds()`, `isDocxRendererId()`,
    `UncompiledComponentError`, `DocxRendererId`.
  - `renderer` on `createDocumentGenerator({...})` and on each
    `generateBuffer` / `generateFile` call, the latter overriding the former.
  - `jto <format> generate --renderer <id>`, and a backend picker in the dev
    playground fed by a new `GET /api/<format>/renderers`. Both formats: the
    plumbing is shared, so `pptxgenjs` / `office-open` are selectable for PPTX
    too. An unsupported feature now answers `400` with the feature name and the
    path that needed it, where it used to be swallowed as a generic `500`.

  **Breaking**

  - `generateDocument()`, `generateDocumentFromJson()` and
    `generateDocumentFromFile()` — all of which returned a docx.js `Document` —
    are removed. Use `generateBufferFromJson` / `generateBufferWithWarnings` /
    `generateBufferFromFile`.
  - `saveDocument(document, path)` and `generateFromConfig()` are removed. Use
    `generateAndSaveFromJson` / `generateAndSaveFromFile`, or write the buffer
    from `generateBufferFromJson` yourself.
  - `DocumentGenerator.generate` is removed; the remaining members are buffer- and
    file-oriented.
  - `DocumentGeneratorOptions.enableCache` is removed. The component render cache
    went with the writer layer — compiling to an IR holds no cross-document state,
    so there is nothing left to cache between documents — and keeping the option
    would have left a documented performance switch that did nothing.
  - The `MemoryCache`, `CacheKeyGenerator` and related cache-analytics facade is
    no longer re-exported from `@json-to-office/core-docx`: no DOCX generation
    path consumes it. Generic cache primitives remain available from
    `@json-to-office/shared/cache` for applications that own their cache keys.
  - The component renderer exports and the text engine behind them
    (`parseTextWithDecorators` and the per-component render functions) are
    removed — they were the docx.js writer layer.
  - `SectionProperties.headers` / `.footers` no longer name docx.js part types.

  No public type now references docx.js.

  **Fixed**

  - Every document-scoped id — revisions, comments, notes, bookmarks, numbering —
    is allocated per compilation instead of in async-local storage, so two
    documents built in one process cannot reach each other's counters. The
    component render cache no longer has to bypass anything to stay correct.
  - The theme's style set is compiled into the IR rather than built by a
    theme-to-docx.js adapter the renderer called itself, so `styles.xml` is
    described by the same data as the rest of the document.
  - A threaded or resolved comment now records a required feature, so a backend
    that cannot write `commentsExtended.xml` refuses the document instead of
    silently flattening the thread.
  - Every `wp:docPr` id the `office-open` backend writes is allocated per render
    rather than from that library's module-level counter, which made the same
    document come out differently on a second call and let two concurrent renders
    interleave. 38 of the 272 corpus cases were affected; none are now.
  - A header or footer whose components are all `enabled: false` now breaks
    Word's link to the previous section instead of inheriting it. The author asked
    for no chrome and the section showed the previous section's, stale or
    confidential content included.
  - The docx.js adapter reads all three chrome slots — `default`, `first` and
    `even` — where it read only `default` in two places: an SVG appearing solely
    in a first-page or even-page part shipped its own bytes labelled `image/png`
    as the raster fallback, and such a part was dropped from the section outright.
  - Each image source is loaded once. The pre-pass fetched every image twice —
    once for its bytes and once for its dimensions — so a source whose response
    changes between the two embedded one image and sized it from another.
  - `text-frames` and `custom-properties` are now recorded as required when a
    document uses them. Both adapters declared and emitted both, but nothing ever
    demanded them, so the capability check for a floating paragraph or a custom
    document property could not fire — a backend that declared them falsely would
    have dropped the content silently.
  - The parity goldens record what each package _contains_ rather than a hash of
    the file. A golden over raw bytes also asserts that the deflate stream is
    identical, and deflate is the runtime's rather than this pipeline's, so a Node
    release with a different zlib fails every case at once while changing nothing
    about any document. Byte stability within one runtime is still asserted, by
    rendering twice, and CI now covers both ends of the advertised `>=20` range.

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

- Updated dependencies [cea7b6b]
- Updated dependencies [767552d]
- Updated dependencies [7319f5f]
- Updated dependencies [39b2ced]
- Updated dependencies [a05a152]
- Updated dependencies [d145c9c]
  - @json-to-office/core-docx@1.0.0
  - @json-to-office/shared@1.0.0
  - @json-to-office/shared-docx@1.0.0

## 0.38.0

### Patch Changes

- Updated dependencies [5ff7bba]
- Updated dependencies [10d3b4f]
  - @json-to-office/core-docx@0.38.0
  - @json-to-office/shared-docx@0.38.0

## 0.37.0

### Patch Changes

- Updated dependencies [7010348]
  - @json-to-office/shared-docx@0.37.0
  - @json-to-office/core-docx@0.37.0

## 0.35.0

### Patch Changes

- Updated dependencies [30d01dd]
  - @json-to-office/shared@0.35.0
  - @json-to-office/shared-docx@0.35.0
  - @json-to-office/core-docx@0.35.0

## 0.34.0

### Minor Changes

- ae9b1d4: Bump the `docx` rendering backend from 9.5.1 to 9.7.1 (six releases, ~11
  months). The pin stays exact in `pnpm.overrides` and in every peer/dependency
  declaration.

  Package-level consequences of the upgrade, verified against the full document
  corpus:

  - Every document now carries a `word/endnotes.xml` part plus its relationship
    and content-type override, and `styles.xml` gains docx's default
    `EndnoteReference` / `EndnoteText` / `EndnoteTextChar` styles. Relationship
    ids shift by one as a result.
  - docx serializes some attributes in a different order than 9.5.1 (for example
    `w:spacing`, `w:compatSetting`) — semantically identical output, but a reason
    no downstream code should pattern-match OOXML on attribute position.

  Verified locally: clean build, typecheck, lint, unchanged test counts, all seven
  corpus documents generate with unique `wp:docPr` ids, structurally valid
  packages (well-formed parts, resolvable relationships, complete content types),
  and LibreOffice PDF rasters unchanged apart from that renderer's own
  page-to-page nondeterminism.

### Patch Changes

- Updated dependencies [2ea0f6a]
- Updated dependencies [4d7c554]
- Updated dependencies [7900859]
- Updated dependencies [ae9b1d4]
- Updated dependencies [912f1b7]
- Updated dependencies [ea6b6af]
- Updated dependencies [234a97e]
- Updated dependencies [34fdb52]
- Updated dependencies [5ea33ff]
- Updated dependencies [1f4e1a5]
- Updated dependencies [ed54627]
- Updated dependencies [4bfe683]
- Updated dependencies [bae9e20]
- Updated dependencies [9e14e7a]
- Updated dependencies [58f5331]
- Updated dependencies [98ca046]
- Updated dependencies [51f958a]
- Updated dependencies [baf0fc8]
- Updated dependencies [ed9ba39]
  - @json-to-office/core-docx@0.34.0
  - @json-to-office/shared-docx@0.34.0

## 0.33.0

### Patch Changes

- Updated dependencies [2ae9268]
  - @json-to-office/shared@0.33.0
  - @json-to-office/shared-docx@0.33.0
  - @json-to-office/core-docx@0.33.0

## 0.32.0

### Patch Changes

- Updated dependencies [b2b0bd3]
  - @json-to-office/shared-docx@0.32.0
  - @json-to-office/core-docx@0.32.0

## 0.31.0

### Patch Changes

- Updated dependencies [6b0545a]
  - @json-to-office/core-docx@0.31.0

## 0.30.0

### Patch Changes

- Updated dependencies [6f27201]
  - @json-to-office/core-docx@0.30.0

## 0.29.0

### Patch Changes

- Updated dependencies [b536bb6]
  - @json-to-office/shared@0.29.0
  - @json-to-office/core-docx@0.29.0
  - @json-to-office/shared-docx@0.29.0

## 0.28.0

### Patch Changes

- Updated dependencies [a033a8b]
  - @json-to-office/core-docx@0.28.0
  - @json-to-office/shared@0.28.0
  - @json-to-office/shared-docx@0.28.0

## 0.27.0

### Patch Changes

- Updated dependencies [43defd5]
  - @json-to-office/core-docx@0.27.0

## 0.25.0

### Patch Changes

- Updated dependencies [2801ec4]
- Updated dependencies [f3b3674]
- Updated dependencies [96c30b3]
  - @json-to-office/shared-docx@0.25.0
  - @json-to-office/core-docx@0.25.0
  - @json-to-office/shared@0.25.0

## 0.24.0

### Patch Changes

- Updated dependencies [5e6f5df]
  - @json-to-office/shared-docx@0.24.0
  - @json-to-office/core-docx@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies [cd2f5f4]
  - @json-to-office/shared-docx@0.23.0
  - @json-to-office/core-docx@0.23.0

## 0.22.0

### Patch Changes

- Updated dependencies [e311268]
- Updated dependencies [e311268]
- Updated dependencies [e311268]
- Updated dependencies [e311268]
- Updated dependencies [e311268]
  - @json-to-office/shared@0.22.0
  - @json-to-office/shared-docx@0.22.0
  - @json-to-office/core-docx@0.22.0

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
  - @json-to-office/core-docx@0.21.0
  - @json-to-office/shared-docx@0.21.0
  - @json-to-office/shared@0.21.0

## 0.20.0

### Patch Changes

- Updated dependencies [bc15ebf]
  - @json-to-office/core-docx@0.20.0
  - @json-to-office/shared-docx@0.20.0

## 0.19.0

### Patch Changes

- Updated dependencies [a332658]
  - @json-to-office/shared-docx@0.19.0
  - @json-to-office/core-docx@0.19.0

## 0.18.0

### Patch Changes

- Updated dependencies [a079015]
  - @json-to-office/core-docx@0.18.0
  - @json-to-office/shared-docx@0.18.0

## 0.17.0

### Minor Changes

- 542f8ad: fix(docx): surface invalid props on generation instead of silently dropping them

  Closes a correctness gap where the object/buffer generation path accepted malformed input and emitted a silently-wrong document. A typo'd prop such as `lineSpacing: { name: 'single' }` (should be `{ type: 'single' }`) used to be quietly discarded, shipping a document with the property missing. Generation now validates by default — the same check the playground already performs — and reports the error instead of producing corrupt output.

  - **Validation on generation (default on).** `generateDocumentFromJson` / `generateBufferFromJson` validate both string and object input and throw `JsonValidationError` on invalid documents. The plugin generator (`createDocumentGenerator().generate/generateBuffer/generateFile`) validates plugin-aware (standard + registered custom components) and throws `ComponentValidationError`. Need the old pass-through behavior? Set `validation: { enabled: false }`.
  - **Clearer messages for typo'd keys.** Component prop objects reject unknown properties, so a misspelled key surfaces as `Unexpected property "<key>"` rather than being ignored. Highcharts `options` stays an open passthrough.
  - **`allowUnknownFields` opt-out.** `validation: { allowUnknownFields: true }` strips unknown properties instead of rejecting them — a one-line migration aid for documents carrying stray keys. Required and typed fields are still enforced.
  - **Plugin validation fixes.** The plugin generator previously computed validation and discarded the result (so it never reported anything), and `generator.validate()` always returned `{ valid: true }`. Both now work, and registered custom components are no longer mistakenly rejected.

  The playground JSON Schema and the runtime validator both derive from the same TypeBox definitions, so they stay in sync. If a document relied on invalid props being silently dropped, pass `validation: { allowUnknownFields: true }` (strip unknown keys) or `validation: { enabled: false }` (skip validation) to keep the prior behavior.

### Patch Changes

- Updated dependencies [542f8ad]
  - @json-to-office/shared-docx@0.17.0
  - @json-to-office/core-docx@0.17.0

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
  - @json-to-office/shared-docx@0.16.0
  - @json-to-office/core-docx@0.16.0

## 0.15.0

### Minor Changes

- ffd5c3d: fix(docx): table rows no longer inherit body-paragraph spacing

  Table cells render as a single wrapper paragraph that previously inherited the
  theme's `normal` style, dragging body-prose rhythm (8–10pt after-spacing +
  1.4–1.5× line) into every row. That inflated row height by ~9pt regardless of
  font size, cell padding, or the cell `height` prop (which is `atLeast`, so it
  can only grow rows). A 5pt-font row still rendered ~22pt tall.

  Table cells (and header cells) now get their own dense paragraph spacing by
  default — no extra before/after spacing, single line. Vertical breathing room
  is the job of cell padding. Measured row pitch for a single-line 11pt row drops
  from ~28.9pt to ~13.7pt.

  Themes can tune table spacing via two new conventional style keys (standard
  `StyleProperties`, no schema change):

  - `styles.tableCell` — paragraph spacing/line for body cells
  - `styles.tableHeader` — paragraph spacing/line for header cells

  ```json
  {
    "styles": {
      "tableCell": {
        "spacing": { "after": 6 },
        "lineSpacing": { "type": "multiple", "value": 1.5 }
      }
    }
  }
  ```

  Note: this changes the rendered height of existing tables (rows become tighter).
  Documents relying on the old roomier rows can restore them per-theme via
  `styles.tableCell` / `styles.tableHeader`.

### Patch Changes

- Updated dependencies [ffd5c3d]
  - @json-to-office/core-docx@0.15.0

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

- Updated dependencies [afe9789]
- Updated dependencies [8916aaa]
  - @json-to-office/shared-docx@0.14.0
  - @json-to-office/core-docx@0.14.0

## 0.13.0

### Minor Changes

- 755d812: feat(core-docx): surface `standardDefinition` from `generate` / `generateBuffer` / `generateFile` — the post-expansion JSON tree (custom plugins resolved) is returned alongside the document/buffer at no extra cost. Plugin `render()` previously ran twice when callers used the standalone inspection method together with a generate call, duplicating side effects (e.g. external API hits).

  `getStandardComponentsDefinition` is **deprecated** and now implemented as a thin wrapper around `generate(...).standardDefinition`. Existing callers keep working; migrate by reading `standardDefinition` directly off any `generate*` result. The method will be removed in a future major.

### Patch Changes

- Updated dependencies [8744ad2]
- Updated dependencies [755d812]
  - @json-to-office/shared@0.13.0
  - @json-to-office/core-docx@0.13.0
  - @json-to-office/shared-docx@0.13.0

## 0.12.0

### Patch Changes

- c4a57aa: chore: drop highcharts-export-server peerDependency — server is only called over HTTP, no runtime import; removes install-time approve-build warning for consumers
- Updated dependencies [c4a57aa]
- Updated dependencies [c4a57aa]
  - @json-to-office/core-docx@0.12.0
  - @json-to-office/shared@0.12.0
  - @json-to-office/shared-docx@0.12.0

## 0.9.0

### Patch Changes

- Updated dependencies [58c0fb6]
  - @json-to-office/shared@0.9.0
  - @json-to-office/shared-docx@0.9.0
  - @json-to-office/core-docx@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [b1af6ef]
  - @json-to-office/core-docx@0.8.0
  - @json-to-office/shared-docx@0.8.0
  - @json-to-office/shared@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [c0bd927]
  - @json-to-office/shared@0.7.0
  - @json-to-office/core-docx@0.7.0
  - @json-to-office/shared-docx@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [84299d3]
  - @json-to-office/shared-docx@0.6.0
  - @json-to-office/core-docx@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [b34970d]
  - @json-to-office/core-docx@0.5.0

## 0.4.0

### Minor Changes

- f6f9f3f: Re-export core generation and validation functions from public API

## 0.3.0

### Patch Changes

- Updated dependencies [de674e0]
  - @json-to-office/shared-docx@0.3.0
  - @json-to-office/core-docx@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [1db99a3]
  - @json-to-office/shared@0.2.0
  - @json-to-office/core-docx@0.2.0
  - @json-to-office/shared-docx@0.2.0
