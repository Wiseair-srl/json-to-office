# @json-to-office/shared

## 1.3.0

### Minor Changes

- efd9982: The pptx `office-open` renderer draws native charts.

  It used to refuse them, for a specific reason: `@office-open` writes chart XML
  whose `<c:f>` references are empty and ships no workbook behind them, so the
  chart drew and **Edit Data** failed. A chart you cannot edit is not the chart
  that was asked for. The adapter now writes that missing half itself, the same
  way the docx side does, so both pptx backends produce an editable native chart
  and the `chart` component is no longer pruned from the `office-open` schema
  branch.

  The repairs are now shared between the two formats — a `c:chartSpace` is
  DrawingML and reads the same in a .docx and a .pptx — and live in
  `@json-to-office/shared/rendering`. Each core keeps its own packaging, because
  `core-docx` zips with adm-zip and `core-pptx` with jszip; the shared module
  deals only in strings and adds no dependency.

  The two backends omit **different amounts** of a chart, so every repair is
  guarded on what the XML actually lacks: `@office-open/pptx` keeps the legend
  position where `@office-open/docx` loses it. Everything else — the cell
  references, the series colours, the axis titles, the bar grouping and
  `c:externalData` — is missing from both and written by the same pass.

  Three of those repairs are shape-dependent. A pie or doughnut is coloured per
  data point, so one `c:dPt` is written per slice; a series fill would paint every
  slice the same colour. A scatter chart has no category axis — both of its axes
  are `c:valAx` — so its axis titles are placed by position rather than by tag.
  And bar grouping has no `ChartSpaceOptions` field at all, so a `stacked` or
  `percentStacked` chart used to come out as side-by-side bars that sum to
  nothing.

  Two details are load-bearing rather than cosmetic:

  - The embedded workbook is named `Microsoft_Excel_Worksheet{N}.xlsx`, matching
    pptxgenjs, because `canonicalizeChartIds` renumbers that exact token — and the
    splice therefore has to run before finalization, not after.
  - Axis titles are spliced into the backend's own axes rather than passed as
    `axes`. Supplying that option replaces the default axis pair wholesale and
    requires ids the adapter cannot allocate; doing so emitted literal
    `<undefined>` elements, which LibreOffice tolerates and PowerPoint offers to
    repair.

  A ragged chart — series of differing lengths, which the pptx compiler accepts
  and the docx one refuses — now writes only the cells it actually has. Padding
  the rectangle put a data point in the workbook the author never wrote and
  claimed a cell range longer than the cached values behind it.

  One chart type stays `pptxgenjs`-only: `bubble`. `@office-open` spells a bubble
  series as x/y/size triples rather than categories and values, and no reading of
  a category label as a numeric x is unambiguous, so it is refused by name at
  validation rather than guessed at or crashed into.

  `isPptxComponentSupported` is removed from `@json-to-office/shared-pptx`; it was
  internal, and with charts supported it returned true unconditionally.

## 1.2.0

### Minor Changes

- ad35065: Make the published PPTX schema and the PPTX validator ask for the same `props`. The generated document schema marked `props` required on every component, including `slide`, whose props are all optional — so `{ "name": "slide", "children": [...] }`, a slide that validates and renders, was flagged by every editor and agent reading that schema. In the other direction the deep validator accepted a bare `{ "name": "text" }`: `text` and `runs` are both optional fields, so an empty props object passed and a missing one passed with it, and the component that exists to draw content was allowed to carry none.

  Requiredness is now one answer per component, held in the registry and read by the schema generator and the deep walk alike: `slide` may omit `props`; every other PPTX component — the `pptx` root, `text`, `image`, `shape`, `table`, `highcharts`, `chart` — must carry it, and its absence is reported as `required_property` at that node's `/props` pointer instead of passing silently.

  **Behaviour change.** Documents that already write `props` everywhere are unaffected. Documents that omitted it on a `text` or an `image` are not: generation runs the deep validator, so those used to produce a file — a slide with nothing drawn on it — and now fail validation with a pointer to the node. That is the intended outcome for `text`, whose whole purpose is the content the key carries; `image` follows because the published schema has required `props` there since it was first generated, and reading the schema's own answer instead would have loosened that contract rather than fixed the disagreement. `image` remains half enforced: the missing key is caught, an empty `"props": {}` is not, since a sourceless image is an `IMAGE_NO_SOURCE` warning at generation rather than an error.

  Three smaller divergences on the same key close with it. `"props": null` was read as an omission by the nested walk — in both formats — while the schema typed the key as an object; it is now reported as a type error at the key it was written on. A slide's `placeholders` record accepted the whole component union, so a `slide`, or the `pptx` root, could sit in a title slot: placeholder values are narrowed to what a slide's `children` accept, in the schema and the walk together, and `jto_describe_component` now names those six components in the slot's schema instead of every component there is. And a registered plugin component may no longer omit `props`, which the published plugin branch has always required — the walk checks the key's presence and leaves its contents to the plugin layer, so the failure arrives as `required_property` at the node rather than as "expected object" from inside the plugin check.

  The generated schemas also declare `$schema` as `http://json-schema.org/draft-07/schema#`, draft-07's own `$id`. The previous `https://` spelling read as an unknown dialect, so a consumer had to rewrite the field or pass `validateSchema: false` before a stock Ajv would compile the schema at all.

  Released as a minor rather than a major deliberately: every document the validator starts rejecting was already invalid against the published JSON Schema for that component, so this brings the runtime into line with the contract it documents rather than changing that contract. The one contract that does change — `slide`'s `props` becoming optional — only accepts more.

## 1.1.0

### Patch Changes

- fdf9c51: Fix the exported DOCX schema applying one renderer's rules to the other

  The exported schema's recursive component definition was named
  `ComponentDefinition` in **both** renderer branches, and the export pass keys
  `definitions` by that name with a plain overwrite — so the last branch walked,
  `office-open`, answered for both. Every position that reaches components
  through that definition (section `props.header`/`props.footer`, table
  `props.columns[].cells[].content`, `componentDefaults.section.header`) got the
  `office-open` view whatever the document's `renderer` said, in both directions:
  a `docxjs` threaded comment in a section header was rejected, and a
  `renderMode: "native"` visual under `docxjs` was accepted. Positions reached
  through a branch's own narrowed child union — a direct child of `docx` or of
  `section` — were always right, which is what made it look local: the same
  `visual` was refused in a section body and accepted in that section's header.

  The runtime validator was correct throughout (`collectDocxRendererErrors` walks
  the real document), so no bad document ever shipped; the cost was
  schema-driven editors and `jto docx validate --schema` showing the other
  renderer's diagnostics.

  The definition is now named per renderer — `ComponentDefinition_docxjs` and
  `ComponentDefinition_office-open` — and the `$ref` fix-up passes resolve a bare
  reference against whatever was actually hoisted rather than one hard-coded
  name. Anything reading `definitions.ComponentDefinition` out of the exported
  DOCX schema should use `docxComponentDefinitionName(renderer)`, newly exported
  from `@json-to-office/shared-docx`.

  The second definition roughly doubles that part of the file: pretty-printed
  `schemas/document.schema.json` goes from 8.7 MB to 12.2 MB, and Ajv's compile
  from ~3.1 s to ~4.3 s. Nesting depth — what decides whether Ajv overflows V8's
  stack — is unchanged, because the second definition sits beside the first
  rather than inside it.

  Also fixes the exported **theme** schema, which did not compile at all. The
  same fix-up pass rewrote every untyped array item into a `$ref` at the root
  definition name whether or not such a definition existed. `componentDefaults`
  is shared between the document and theme schemas, and its `section.header` and
  `section.footer` hold components — but only the document schema carries a
  component definition to point them at, so `theme.schema.json` shipped with an
  unresolvable `#/definitions/ComponentDefinition`, and Ajv refuses to compile a
  schema over one. Every theme validated against the shipped schema failed on the
  schema itself, whatever the theme said. With nothing to point at, the item now
  stays untyped. The CLI's own `--type theme` was never affected: it validates
  against TypeBox, not the exported schema.

## 1.0.0

### Major Changes

- d145c9c: Remove the retired generic component-cache subpath and its unused public
  helpers. Renderer generation remains stateless; only document-output, asset,
  font and rasterizer caches remain.

  Rename the format-adapter reset hook from `clearComponentCache` to
  `resetCacheStats`, matching its remaining responsibility, and update the
  playground cache-clear message.

### Minor Changes

- 39b2ced: PPTX generation now compiles to a renderer-neutral intermediate representation

  Presentations are compiled to `PptxIR` — plain, serialisable data describing a
  finished deck in PowerPoint terms — and a renderer adapter turns that into
  bytes. PptxGenJS is now one backend behind that seam rather than the pipeline
  itself.

  **Output is unchanged.** Every case in the parity corpus produces a
  identical package, part for part, checked against digests recorded from the previous
  implementation (`src/__tests__/corpus-goldens.test.ts`).

  **New**

  - `renderer` option on every PPTX generation entry point and on the plugin
    generator: `'pptxgenjs'` (default) or `'office-open'` (experimental, opt-in).
    An unsupported feature fails before any bytes are produced, with the feature
    name and the IR path that needed it.
  - An experimental `@office-open/pptx` backend, declared as an optional peer
    dependency. It covers text, shapes, images, fills, lines, shadows, plain
    tables, backgrounds, notes, hidden slides, transitions, groups and
    hyperlinks; SVG, native charts, image rotation, vertical flips, masters and
    merged table cells are verified gaps and are rejected up front rather than
    rendered incorrectly.
  - `PptxRendererId`, `DEFAULT_PPTX_RENDERER_ID`, `pptxRendererIds()`,
    `isPptxRendererId()`, `UncompiledComponentError`.
  - `@json-to-office/shared` gains `@json-to-office/shared/rendering`: the
    format-independent renderer contract, capability diffing and structured
    renderer diagnostics.

  **Breaking**

  - `generatePresentation()` — returned a `PptxGenJS` instance — is removed.
    Use `generateBufferFromJson` / `generateBufferWithWarnings`.
  - `savePresentation(pptx, path)` is removed. Use `generateAndSaveFromJson`, or
    write the buffer from `generateBufferFromJson` yourself.
  - `PresentationGenerator.generate` and `PresentationGenerator.save` are removed;
    the remaining members are buffer- and file-oriented.
  - The component renderer exports (`renderTextComponent`, `renderImageComponent`,
    `renderShapeComponent`, `renderTableComponent`, `renderHighchartsComponent`,
    `renderComponent`) are removed — they were the PptxGenJS writer layer.
  - `packagePresentationBuffer` is removed from `@json-to-office/core-pptx`.
    Packaging is split along the seam it was straddling: the PptxGenJS repairs
    (gradient/pattern fill splice, table-style GUID, SVG preview) belong to that
    adapter, and generic OOXML finalization — canonical chart ids, pinned
    timestamps, stable zip encoding — is what every backend gets. Both halves
    share one open zip, so the package is still read once and written once.
  - `PresentationPackagingOptions` no longer carries `pendingFills` or
    `warnings`. Both were adapter plumbing that had leaked into the public
    generation options; what a caller can say is `deterministic` and
    `generatedAt`.

  No public type now references PptxGenJS.

  **Fixed**

  - Image `sizing` (`contain` / `cover`) and aspect-ratio auto-fill are resolved
    in one place with the intrinsic size, rather than partly in the writer.
  - Post-render repairs — the SVG preview fix in particular — report into the
    same structured warning list as the rest of the pipeline on every path,
    including the plugin generator.
  - `underline: false` no longer underlines. Any boolean used to turn underline
    on, so saying `false` switched it on.
  - `bullet: { type: 'bullet' }` now produces a bullet. The object form was
    passed through in a shape the backend ignored; the boolean form always
    worked.
  - `bullet: false` no longer produces a bullet. Every boolean lowered to an
    enabled bullet, so an explicit "no bullet" could not override one inherited
    from a style. `bullet: { type: 'number' }` with no other field now numbers
    rather than clearing the bullet, and a custom glyph reaches both backends
    instead of being dropped by each in its own way.
  - A four-value `margin` keeps the `[top, right, bottom, left]` order the schema
    documents. PptxGenJS's text path reads those four numbers as
    `[left, right, bottom, top]` — disagreeing with its own table path — and the
    office-open adapter read them as `[left, top, right, bottom]`; both are
    corrected in the adapter, so an asymmetric text box is no longer rotated by a
    side.
  - Slide transitions survive processing. `transition` was accepted by the schema
    and dropped before the IR, so `office-open` could not emit one and PptxGenJS —
    which has no transition API — could not refuse it.
  - A rounded table positioned with percentages now gets its rounded backdrop,
    which was previously drawn only when `x` and `y` were plain numbers.
  - The `office-open` backend honours `deterministic` and `generatedAt`. It
    stamped core metadata with the wall clock and numbered drawings from a
    process-global counter, so the same deck rendered twice produced different
    bytes.
  - The `office-open` backend writes the authored theme (`theme1.xml` carries the
    heading and body faces and the resolved palette, where it used to carry
    Office defaults), the `company` document property, and a table's border and
    fill. Five further gaps are now declared rather than silently dropped —
    `image-crop`, `image-rounding`, `table-insets`, `table-rounded-corners` and
    `table-auto-page` — so a deck using them fails with the feature name and the
    IR path instead of losing a crop, a rounded corner or half a table.
  - The parity goldens record what each package _contains_ rather than a hash of
    the file. A golden over raw bytes also asserts that the deflate stream is
    identical, and deflate is the runtime's rather than this pipeline's, so a Node
    release with a different zlib fails every case at once while changing nothing
    about any deck. Byte stability within one runtime is still asserted, by
    rendering twice, and CI now covers both ends of the advertised `>=20` range.

### Patch Changes

- a05a152: Document JSON can now select its renderer with an optional top-level
  `renderer` discriminator. Omission selects `docxjs` for DOCX and `pptxgenjs`
  for PPTX. Generated schemas, runtime validation, autocomplete and exported
  renderer-profile types derive backend-specific branches from the canonical
  component schemas; compiler capability checks remain authoritative after custom
  component expansion and asset resolution.

  Runtime custom-component schemas are rebuilt from the current plugin
  definitions, so reloading the same component name and version cannot reuse stale
  props or child metadata.

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

## 0.33.0

### Minor Changes

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

## 0.29.0

### Minor Changes

- b536bb6: feat: coalesce per-document visual rasterization into batched calls (#153)

  A docx render used to rasterize each `visual` component with its own
  `/rasterize` round trip and its own LibreOffice launch — ~25 sequential
  calls for the bundled annual-report templates, which starved the render
  server's rate limit (#152).

  Rendering now runs a per-document pre-pass that collects every enabled
  visual, dedupes identical ones, and rasterizes them together. A batch is N
  independent single-slide decks converted in ONE soffice launch (the launch
  is the amortized cost): each slide keeps its own PDF/PNG, its own size and
  dpi — so nothing is grouped and no page↔visual index mapping exists — and
  its cache key is identical to the single-slide path, so batch and single
  share the disk cache.

  - `shared`: `PptxRasterizeBatch*` types, `PptxBatchRasterizer`,
    `PptxServiceConfig.renderBatch`, `MAX_RASTERIZE_BATCH_SLIDES`.
  - `jto-cli`: `createLibreOfficePptxBatchRasterizer()`; single and batch
    share one engine with per-slide results, and a slide whose PDF is missing
    after a batch launch is retried once in isolation.
  - `core-docx`: `renderDocument` pre-pass seeding a keyed result map;
    `renderVisualComponent` falls back to per-visual rasterization on any
    miss, so old servers (404 on the batch route), transport failures, or
    collection gaps degrade to today's behavior. `flattenVisuals` accepts
    `rasterizeBatch`.
  - `jto`: additive `POST /rasterize/batch` on both surfaces (playground +
    render server) with per-slide validation, source policy, and 200-with-
    item-errors semantics; shares middleware and one rate-limit bucket with
    `/rasterize`. Per-slide errors are stage-tagged: slide-content (`build`)
    errors surface verbatim, tooling errors are sanitized to a generic
    message (raw detail goes to the server log). Both routes enforce an
    estimated pixel budget (64MP/slide, 256MP/batch).

  Robustness bounds: the engine runs against a wall-clock deadline (one
  batch-scaled soffice window + one pdftoppm window), isolated retries for
  missing PDFs are capped at 3, and a batch where nothing converted fails
  fast instead of retrying per slide.

  One document is now ~one request and ~one soffice launch, so public
  rasterize rate limits can come back down.

## 0.28.0

### Minor Changes

- a033a8b: Relative image/media paths now resolve against the document's own directory instead of `process.cwd()` (#142). New `baseDir` option on core generation (`generateBufferFromJson` et al.), plugin builders (constructor + per-call), CLI `generate` (auto-set to the input file's directory), the playground server (via `options.sourceName` mapped through discovery), and the pptx rasterizer request (docx `visual` components forward it). cwd stays the fallback when no baseDir is provided. Stock template media paths shrunk to document-relative `media/...`; stale `templates` entry dropped from `packages/jto` package `files`.

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

## 0.22.0

### Minor Changes

- e311268: feat(themes): one chart palette vocabulary for DOCX and PPTX

  The default chart palette was declared twice with two different token lists: PPTX resolved `primary, secondary, accent, accent4, accent5, accent6`, while the DOCX `highcharts` component resolved only `primary, secondary, accent` — and the DOCX theme schema had no way to spell the other three, so a document could not reach them even deliberately.

  - `DEFAULT_CHART_THEME_COLORS` moves to `@json-to-office/shared` and is exported from its root. `@json-to-office/core-pptx`'s `utils/color` re-exports it, so every PPTX call site keeps importing colours from the module it already used.
  - The DOCX `ThemeConfigSchema` gains optional `accent4`, `accent5`, and `accent6`, named to match the PPTX theme. The schema is strictly more permissive: a theme JSON carrying those keys used to be rejected at load and is now accepted, and every theme that validated before still validates.
  - The DOCX `highcharts` component resolves all six tokens, in the same order PPTX does. A theme that fills every slot with a hex value now produces the same palette in a document and in a deck, letter case included.
  - **Both** chart palettes resolve each token through the theme's own recursive name resolution instead of prefixing a `#` to the raw value. `"accent4": "primary"` used to post the literal string `"#primary"` to the export server and now posts the colour `primary` holds; a value that resolves to nothing (a typo'd token name, or a reference cycle) is skipped instead of being handed to the renderer verbatim. A token whose value is literal hex — every bundled theme and the overwhelming majority of custom ones — produces a byte-identical payload, original letter case included.

    On the PPTX side this was the same defect with a worse symptom: `"accent4": "primary"` reached pptxgenjs as the literal token name, which it answered by painting the series **black** and logging to the console while the generation `warnings` array stayed empty and the exit code stayed 0. Both the native `chart` and the `highcharts` paths were affected. A PPTX theme colour that is defined but resolves to nothing now raises an `UNKNOWN_COLOR` warning and falls back to `primary` instead of being passed through unvalidated — and because that lives in `resolveColor`, it applies to **every** PPTX colour prop (text, shape, table, image, template), not only charts. Callers counting warnings on a broken theme will see one more; nothing changes for a theme whose colours are all literal hex, which is every bundled PPTX theme.

    Note the asymmetry in what the two schemas will even accept: a DOCX theme colour may be `#RRGGBB` or another colour's name, while a PPTX theme colour must be strict hex, so a PPTX reference chain only arrives through a theme the schema never validates — a `customThemes` object, a `--theme-path` file (parsed as plain JSON), or an inline `props.theme` in a run that never calls the validator. Those are exactly the paths where the black series showed up.

    When _no_ token resolves — a hand-written theme whose colours are all CSS names, say — the native `chart` now leaves `chartColors` unset instead of passing an empty array. pptxgenjs indexes `chartColors[i % 0]`, gets `undefined`, and paints every series black without warning; omitting the option hands it its own default palette. The `highcharts` paths already guarded this.

    One deliberate divergence: a reference cycle is "unresolvable" on the PPTX side (dropped from the implicit palette, `UNKNOWN_COLOR` when named explicitly), because `chainToHex` carries a `seen` guard. DOCX's `resolveColor` has no cycle guard; the chart palette catches the resulting stack overflow and drops the slot, but naming a cycled token from an ordinary colour prop still blows the stack.

  **Charts recolour only where a theme actually defines the new tokens.** The five bundled DOCX themes define none, so their charts keep the three-colour palette they had. A theme handed to the library as an object — through `customThemes`, or the `theme` option on `createDocumentGenerator` — that already carried `accent4`–`accent6` bypassed schema validation and was silently ignored by DOCX charts; those charts now pick the extra colours up. Explicit `options.colors` still wins everywhere.

  **Both formats now treat a slot the theme leaves unset the same way: they skip it.** The implicit palette is only as long as the theme has tokens defined, no warning is emitted, and the chart library reuses the shorter list. Skipping compacts rather than leaving a gap — a theme with `accent5` but no `accent4` yields `[primary, secondary, accent, accent5]`, so `accent5` paints the fourth series. An explicit palette is unaffected: a `highcharts` `options.colors` is still forwarded untouched in both formats, and a PPTX `chartColors` entry naming an unset token still resolves to `primary` with a `THEME_COLOR_FALLBACK` warning, because naming a token you never defined is an authoring error rather than a partially filled theme.

  That unification is the PPTX-side behaviour change: a PPTX theme leaving `accent4`–`accent6` unset used to get a six-entry palette with `primary` repeated in slots 4–6, plus three `THEME_COLOR_FALLBACK` warnings per chart. It now gets a shorter palette and no warnings, so series 4+ cycle the theme's colours instead of all painting `primary`. All three bundled PPTX themes fill every slot, so decks on a bundled theme are unchanged; custom PPTX themes with holes will see charts recolour and pipeline warning counts drop. DOCX already skipped and is unchanged in this respect.

  `resolveColor`, `isValidColorName` and `getAvailableColorNames` in core-docx also stopped keying off `in`: an optional colour slot that is present but `undefined` counts as unset everywhere. `resolveColor` raises the same strict `Invalid color value` error as for an absent slot rather than a `TypeError`, `isValidColorName` returns `false` for that slot, and `getAvailableColorNames` omits it.

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

## 0.13.2

### Patch Changes

- f6f1f4a: fix(shared): unref `MemoryCache` cleanup timer so the CLI exits promptly

  The component-cache cleanup `setInterval` (5-minute period) kept the Node
  event loop alive after work finished, making `jto-cli docx generate` hang
  for up to 5 minutes per run. The interval is now `.unref()`-ed so it no
  longer blocks process exit.

## 0.13.0

### Minor Changes

- 8744ad2: feat(core-docx): per-call `preserveCustomComponents` option on `generate` / `generateBuffer` / `generateFile`. Listed component names are kept verbatim (un-expanded) in a new `preservedDefinition` field on the result; `standardDefinition` and the rendered DOCX are unchanged. `generateFile` also writes a JSON sidecar (default `<out>-preserved.json`, override via `preservedOutputPath`). Unknown names throw `UnknownPreservedComponentError` (exported from `@json-to-office/shared` and `@json-to-office/core-docx`).

## 0.12.0

### Minor Changes

- c4a57aa: feat(highcharts): allow `services.highcharts.headers` to be a function of the request body, enabling per-request signing/auth derived from payload. Adds `HighchartsHeaders` and `HighchartsHeadersResolver` exports from `@json-to-office/shared`. Static-object form remains supported.

## 0.9.0

### Minor Changes

- 58c0fb6: Font system across the stack.

  - **shared**: font catalog, registry, and resolver with Google / URL / file / data / variable sources; font validation; substitution tables.
  - **core-docx / core-pptx**: new `fonts` generator option with `custom` (default, keeps references as-is) and `substitute` (rewrites non-safe families to safe equivalents) export modes. Optional `strict` flag throws on unresolved non-safe references. Font-weight synthesis via `fontFace` / `bold` / `fontWeight` aliasing.
  - **shared-docx / shared-pptx**: new optional font fields on text / shape / table / theme schemas (backward compatible).
  - **jto CLI**: `--font`, `--fonts-dir` flags and a `fonts` subcommand.
  - **jto server**: `/api/fonts` catalog, auto-Google resolution, per-platform font staging (macOS / Windows / fontconfig) for LibreOffice preview.
  - **jto client**: font picker dialog (Safe / Google / Uploads), Monaco CodeLens for font fields, live `@font-face` injection in the playground preview.

## 0.8.0

### Minor Changes

- b1af6ef: Centralize component-defaults resolution into a single tree walk (`resolveComponentTree`) before rendering, removing per-component resolve calls from individual renderers. Support document-level `componentDefaults` override in report/presentation props. Extract shared `deepMerge` utility.

## 0.7.0

### Minor Changes

- c0bd927: Add generator-level services config for Highcharts export server endpoint and auth headers

## 0.2.0

### Minor Changes

- 1db99a3: Extract shared plugin infrastructure from core-docx into shared package and add plugin system for PPTX generation
