# @json-to-office/jto

## 0.38.0

### Patch Changes

- 5ff7bba: Build the hosted playground image on `node:22-trixie-slim`.

  Debian bookworm is frozen at LibreOffice 7.4, which cannot parse a table-of-
  contents field nested in a `w:sdt` and prints the raw field instruction into
  the document instead — visible on every hosted PDF with a TOC. Trixie carries
  LibreOffice 25.2, which renders it correctly, and Node 22.

  The suite is pinned explicitly (`-trixie-slim`, not `-slim`) so the LibreOffice
  version cannot move when Docker retags the default.

- Updated dependencies [5ff7bba]
- Updated dependencies [10d3b4f]
  - @json-to-office/core-docx@0.38.0
  - @json-to-office/shared-docx@0.38.0
  - @json-to-office/jto-cli@0.38.0

## 0.37.0

### Patch Changes

- Updated dependencies [7010348]
  - @json-to-office/shared-docx@0.37.0
  - @json-to-office/core-docx@0.37.0
  - @json-to-office/jto-cli@0.37.0

## 0.36.0

### Patch Changes

- Updated dependencies [c89a2d8]
  - @json-to-office/core-pptx@0.36.0
  - @json-to-office/jto-cli@0.36.0

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
  - @json-to-office/shared-docx@0.35.0
  - @json-to-office/shared-pptx@0.35.0
  - @json-to-office/core-docx@0.35.0
  - @json-to-office/core-pptx@0.35.0
  - @json-to-office/jto-cli@0.35.0

## 0.34.0

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
  - @json-to-office/jto-cli@0.34.0

## 0.33.2

### Patch Changes

- d94be7f: Harden on-demand plugin loading for schema generation (review follow-ups to
  the load-on-demand fix):

  - Production keeps its authorization policy: on-demand loading is a
    dev-playground affordance, so in production `/discovery/schemas/document`
    no longer triggers plugin discovery — loading stays behind the
    authenticated `POST /load-plugins`, and schema generation falls back to
    whatever is already registered.
  - `PluginRegistry.discoverAndLoad()` now coalesces concurrent callers into a
    single discovery pass, so the bootstrap POST and on-demand schema loads
    racing on page load no longer double-walk the project or re-import plugins.

- Updated dependencies [d94be7f]
  - @json-to-office/jto-cli@0.33.2

## 0.33.1

### Patch Changes

- c441087: Plugin components reliably reach editor schemas: the document-schema endpoint
  loads requested plugins on demand instead of depending on the playground's
  bootstrap `POST /load-plugins` having run first.

  The playground fires that bootstrap POST and the first schema fetch in
  parallel on page load. When the schema request won the race — or the POST
  failed — the plugin registry was empty, the requested plugins were silently
  dropped, and Monaco kept (and cached) a plugin-less schema: enabled components
  neither completed under `name` nor validated, until a plugin toggle forced a
  refetch. `/discovery/schemas/document` now ensures the requested plugins are
  registered before generating (in-flight-guarded discover-and-load; the
  registry's load fingerprint makes repeats a no-op), so any schema request is
  correct regardless of client bootstrap order.

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
  - @json-to-office/shared-docx@0.33.0
  - @json-to-office/shared-pptx@0.33.0
  - @json-to-office/core-docx@0.33.0
  - @json-to-office/core-pptx@0.33.0
  - @json-to-office/jto-cli@0.33.0

## 0.32.0

### Minor Changes

- e67aa4e: Playground sidebar gains an Outline section — a semantic table of contents
  for the document in the active editor tab.

  PPTX documents outline as numbered slides labeled by their title text, with
  per-component rows (text, chart, table, image, shape…) carrying type icons
  and content snippets. DOCX documents outline as the heading hierarchy —
  non-heading components nest under their preceding heading, and untitled
  `section` containers borrow their first heading or paragraph as a label.
  Theme files outline as their top-level keys with nested keys and value
  previews one level down.

  The tree is bidirectionally synced with Monaco: clicking a node reveals and
  flashes its JSON range, and moving the cursor highlights (and auto-expands
  to) the node it sits inside. Nodes containing schema validation errors show a
  red dot, propagated to their ancestors. Sibling nodes can be drag-reordered —
  moving a slide, or a whole DOCX heading section with all its content, as a
  single undoable text edit that preserves formatting and keeps collapsed
  long-string chips intact (the collapse controller gained a
  `resyncDecorations()` primitive that re-anchors chips to their sentinels
  after text moves).

  The outline is built with jsonc-parser's error-tolerant `parseTree`, so it
  stays alive while the JSON is temporarily invalid mid-edit.

- b2b0bd3: BREAKING (DOCX): `section` no longer accepts `title`/`level` props. They
  conflated naming with content — a section title silently synthesized a
  heading component at the top of the section (and bent TOC scoping and
  pageBreak handling around it).

  Sections now take `meta.title` instead: a pure authoring label, never
  rendered, shown by editors and outlines (the playground sidebar uses it as
  the section's outline label). For a visible title, add an explicit `heading`
  child — what the synthesized heading was doing anyway, now stated in the
  document.

  Migration: `"props": { "title": "X", "level": 2 }` becomes
  `"props": { "meta": { "title": "X" } }` plus, if the rendered heading was
  wanted, a `{ "name": "heading", "props": { "text": "X", "level": 2 } }`
  first child. Section-scoped TOCs still work via section bookmarks; they no
  longer skip a synthesized title level. No stock template or example used
  `title`.

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

### Patch Changes

- d4f93f2: Restructure the modern-annual-report-1/2/3 templates from a single section
  holding ~400 components into one section per page (24 sections each). The
  empty pageBreak-carrying delimiter paragraphs are replaced by explicit
  `section` components with `pageBreak: true`, matching the structure the
  layout engine was already producing internally (the generated documents
  carried 24 sectPr before and after). Rendered output is pixel-identical on
  every page of all three templates; the sidebar outline now shows a navigable,
  reorderable table of contents for them instead of one opaque section.
- Updated dependencies [b2b0bd3]
- Updated dependencies [0b021e5]
  - @json-to-office/shared-docx@0.32.0
  - @json-to-office/core-docx@0.32.0
  - @json-to-office/shared-pptx@0.32.0
  - @json-to-office/jto-cli@0.32.0
  - @json-to-office/core-pptx@0.32.0

## 0.31.1

### Patch Changes

- 0c740b0: Fix "Copy standard components" 400 for documents referencing bundled media.

  In safe mode, `/standard-components` validated the raw definition against the
  outbound-source policy, so any discovered document referencing relative
  `media/...` paths was rejected with a 400 — while `/generate` accepted the same
  document because it inlines discovered media first. The route now mirrors
  `/generate`'s prologue (sourceName → baseDir → inline media before source
  validation) and passes `customThemes` through as a theme registry instead of
  forcing the first custom theme. The playground client now sends
  `options.sourceName` and the current custom themes with the request, and reads
  the server's `error` field so the toast shows the real failure reason instead
  of "Request failed with status 400".

- 8ce36da: Richer, more honest generation loading UI in the playground.

  The full-screen "Generating Document" loader now shows the document's title,
  a summary of what's being built (sections, visuals, images, tables,
  paragraphs…), a live elapsed timer, and — once a build takes more than a few
  seconds — rotating context hints tuned to the document (e.g. how many visuals
  are being rasterized and that later builds reuse the cache). The active stage
  uses an honest indeterminate sweep instead of a fake full progress bar, with
  proper check icons for completed stages. The overlay shown over an existing
  preview during rebuilds gains the stage message and elapsed time. Both
  surfaces get a Cancel button wired to a new store-registered abort that
  cancels the in-flight build quietly (no error banner).

- Updated dependencies [3dac998]
  - @json-to-office/shared-docx@0.31.1

## 0.31.0

### Patch Changes

- 6b0545a: fix: make cache observability truthful and cross-render caching real (#156)

  The Cache Performance modal was structurally blind: component types that
  bypass the cache by design recorded nothing, the visual rasterizer's two
  caches exposed no stats, per-render date keys killed every cross-render
  lookup for date-less documents, repeated `/load-plugins` calls reset the
  stats before they meant anything, and "Clear all caches" wasn't.

  - `core-docx`: design-bypassed renders are counted per type with a reason
    (`getComponentBypassStats`; included in `getComponentCacheStats`). The
    generation date only joins a component's cache key when its props or
    children reference a date-sensitive placeholder (`{DATE}`, `{DATETIME}`,
    `{YEAR}`, custom registrations — `{PAGE}`/`{TOTAL_PAGES}` are field
    codes and excluded), so date-less components hit across renders. The
    visual pre-pass exports cumulative dedupe counters
    (`getVisualPrepassStats`).
  - `jto-cli`: the rasterizer exposes `getRasterizerCacheStats()` (disk
    hits/misses, batch dedupe, rendered/failed, PNG entries and bytes) and
    `clearRasterizerCache()`. `PluginRegistry` fingerprints each loaded set
    (paths + mtimes + sizes): reloading an unchanged set is a no-op — no
    re-import, no cache invalidation — and a changed set invalidates ONCE
    per batch instead of once per plugin.
  - `jto`: `/cache-stats` returns the rasterizer block and bypassed-type
    rows; the modal renders "uncached by design" rows and a Visual
    Rasterizer section. `DELETE /cache` now also clears the component
    render cache and the rasterizer PNG disk cache. The client collapses
    concurrent load-plugins calls into one request.

- Updated dependencies [6b0545a]
  - @json-to-office/core-docx@0.31.0
  - @json-to-office/jto-cli@0.31.0

## 0.30.0

### Patch Changes

- 6f27201: fix: make the playground's "Copy standard components" reliable and cheap (#155)

  The action failed two ways: it was silently disabled until the first Run
  (gated on the generated output instead of the editor document), and when it
  did run, the clipboard write happened after a slow server round trip — the
  click's user activation had expired, so Chromium rejected the write with
  `NotAllowedError` even though the request succeeded. The endpoint was slow
  by construction: it used the deprecated `getStandardComponentsDefinition`,
  which runs a full generation (LibreOffice visual rasterization included)
  just to surface the JSON tree.

  - `core-docx`: new `expandStandardDefinition()` on plugin generators —
    validation, theme resolution, custom-component expansion, and
    normalization only. No fonts, no layout, no rendering, no external
    services. Returns `StandardDefinitionResult`.
  - `jto-cli`: `GeneratorResult.getStandardDefinition` wires the new cheap
    path (replaces the deprecated `getStandardComponentsDefinition`
    pass-through, which no longer had in-repo callers).
  - `jto` server: `/standard-components` uses the expansion-only path and
    maps validation failures to 400 instead of 500.
  - `jto` playground: the clipboard write starts synchronously inside the
    click (promise-payload `ClipboardItem`), so the browser authorizes it
    while the gesture is live and the payload resolves when the fetch lands;
    a denied write falls back to a dialog with the JSON and its own Copy
    button. The menu item is enabled from the editor's active document (works
    before the first Run, themes excluded) and explains itself with a tooltip
    when no document is open.

- Updated dependencies [6f27201]
  - @json-to-office/core-docx@0.30.0
  - @json-to-office/jto-cli@0.30.0

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

### Patch Changes

- Updated dependencies [b536bb6]
  - @json-to-office/shared@0.29.0
  - @json-to-office/core-docx@0.29.0
  - @json-to-office/jto-cli@0.29.0
  - @json-to-office/core-pptx@0.29.0
  - @json-to-office/shared-docx@0.29.0
  - @json-to-office/shared-pptx@0.29.0

## 0.28.1

### Patch Changes

- 00a5329: fix(server): inline bundled template media as data URLs in safe mode

  Deployed playgrounds run with `OUTBOUND_SOURCE_MODE=safe`, which rejects the
  relative `media/...` paths every bundled template ships with — and docx
  `visual` components ship their JSON to the remote rasterizer, which has no
  access to those files anyway. When a request's `sourceName` matches a
  server-discovered document, its relative image references (image components,
  `{ image: { path } }` backgrounds, visual elements) are now resolved against
  the document's directory, containment-checked, and inlined as `data:` URLs
  before outbound-source validation. Arbitrary client paths stay blocked;
  development mode keeps filesystem resolution untouched.

## 0.28.0

### Minor Changes

- a033a8b: Relative image/media paths now resolve against the document's own directory instead of `process.cwd()` (#142). New `baseDir` option on core generation (`generateBufferFromJson` et al.), plugin builders (constructor + per-call), CLI `generate` (auto-set to the input file's directory), the playground server (via `options.sourceName` mapped through discovery), and the pptx rasterizer request (docx `visual` components forward it). cwd stays the fallback when no baseDir is provided. Stock template media paths shrunk to document-relative `media/...`; stale `templates` entry dropped from `packages/jto` package `files`.

### Patch Changes

- Updated dependencies [a033a8b]
  - @json-to-office/core-docx@0.28.0
  - @json-to-office/core-pptx@0.28.0
  - @json-to-office/shared@0.28.0
  - @json-to-office/jto-cli@0.28.0
  - @json-to-office/shared-docx@0.28.0
  - @json-to-office/shared-pptx@0.28.0

## 0.27.0

### Patch Changes

- Updated dependencies [43defd5]
  - @json-to-office/core-docx@0.27.0
  - @json-to-office/core-pptx@0.27.0
  - @json-to-office/jto-cli@0.27.0

## 0.26.0

### Patch Changes

- fae67ed: Ship the eight stock templates with the playground.

  They lived in the repo-root `templates/` directory, which the Docker image
  never copies, so the deployed DOCX and PPTX playgrounds listed none of them.
  Moved the documents and their media under
  `packages/jto/src/client/public/templates/`, next to the Company deck
  templates that already reach the deployed playgrounds, and rewrote the image
  paths to match — they resolve against the process CWD, which is the repo root
  locally and `/app` in the container.

- Updated dependencies [df039c1]
- Updated dependencies [6aa719e]
  - @json-to-office/core-pptx@0.26.0
  - @json-to-office/jto-cli@0.26.0

## 0.25.0

### Patch Changes

- 2801ec4: Fix the playground JSON editor having no schema bound to its models: the
  editor now builds a model URI carrying the format's double extension so it
  matches the schema's `fileMatch`, restoring schema-driven completions,
  validation and hovers. Root `children` in the exported document schema also
  now accepts `section` plus everything a section accepts, matching what the
  validator and generator have always taken.
- Updated dependencies [2801ec4]
- Updated dependencies [f3b3674]
- Updated dependencies [96c30b3]
  - @json-to-office/shared-docx@0.25.0
  - @json-to-office/core-docx@0.25.0
  - @json-to-office/core-pptx@0.25.0
  - @json-to-office/shared-pptx@0.25.0
  - @json-to-office/shared@0.25.0
  - @json-to-office/jto-cli@0.25.0

## 0.24.0

### Minor Changes

- 5e6f5df: Rebuild the playground sidebar around the files you have open.

  The rail carried two competing ideas at once. "Active Documents" and "Active
  Themes" were the working set; "Discovered Resources" was the library — but the
  library nested its files two levels deep (Discovered Resources → Project
  Documents → the file), so a 256px column spent roughly 40px of its width on
  chrome before showing a filename. There was no way to search any of it. With a
  dozen documents, themes and plugins in the project, scanning was the slowest
  thing about the panel.

  The library sections are now top level, one indent, one neutral tree guide. A
  single filter across the top narrows open files, project files and plugins
  together, auto-expanding whatever still has matches; `/` focuses it, `Esc`
  clears it, and matched runs are marked with weight rather than a tint, because
  every hue in this rail already means something.

  State reads more precisely and more quietly. The file icon no longer swaps to a
  play glyph when a document is previewing — that swap cost the only cue
  distinguishing a document from a theme. Instead exactly one row carries a filled
  bed and a `--primary` stripe (the one the editor has open), while previewing and
  theme-in-use are marked with a `--data-blue` or `--warning` dot on the trailing
  edge. Decorative left stripes are gone from the library rows, so a stripe now
  only ever means "open in the editor". The collapsed rail shows real file icons
  in place of two-letter monograms, which had rendered both `contract-v1` and
  `contract-v2` as "CO".

  Rows are denser (28px, 13px text, 14px icons) and each one reveals an overflow
  menu on hover — rename, download and delete had been reachable only by
  right-clicking. Empty sections are buttons that create the thing they are empty
  of. Plugin names now label their switch, so toggling a plugin is a 28px row
  target rather than an 18px track.

  Muted text was recalibrated: several rail values sat below WCAG AA (section
  labels at 3.4:1, counts at 2.1:1). Rail text now lives in a documented
  `/65`–`/85` opacity band and takes its hierarchy from size, weight and uppercase
  tracking instead of fading out.

  Two dead paths went with the rewrite: a `SchemaDialog` whose open-state setter
  was never called, and a per-render `JSON.parse` of every open document feeding an
  indicator prop the row component ignored.

- 5e6f5df: Align the playground UI with the Wiseair design system.

  The playground now runs on the Banani tokens from `wiseair-mono/apps/dashboard`.
  Light is the cool-grey enterprise surface (canvas `#f4f6f9`, white panels,
  `#e2e6ed` hairlines, Brand Slate `#383F5D` primary, `#546f9c` secondary text).
  Dark is a surface ramp rather than one flat near-black — canvas `#1D2130` → card
  `#282c3e` → subtle fill `#3b4054` → border `#494e65`, over a recessed `#10141e`
  sidebar rail — so cards, popovers and muted fills stay distinguishable from each
  other. Also: the 2/4/6/10px radius ladder, the dense 11/13/14/16/20/24/30/36
  type scale, and self-hosted Inter in place of Geist (dropping a render-blocking
  Google Fonts request).

  Ad-hoc Tailwind palette colors scattered across the sidebar, warnings panel,
  preview status bar and schema viewer are gone; document and theme states now use
  the system's own vocabulary (`success`, `warning`, `destructive`, `data-blue`,
  `accent2`, `header-bg`, `sidebar-accent`) with the dashboard's soft-wash callout
  recipe, so they read as one system in both themes.

  Components follow the same recipes: flat surfaces separated by hairlines rather
  than shadows, 2px-cornered controls, 4px badges, 6px floating overlays. The
  Monaco editor gets `jto-light` / `jto-dark` themes so the editor pane is painted
  from the same surface tokens as the rest of the shell instead of stock white /
  `#1E1E1E`.

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

- Updated dependencies [5e6f5df]
  - @json-to-office/shared-docx@0.24.0
  - @json-to-office/shared-pptx@0.24.0
  - @json-to-office/core-docx@0.24.0
  - @json-to-office/jto-cli@0.24.0
  - @json-to-office/core-pptx@0.24.0

## 0.23.0

### Minor Changes

- cd2f5f4: fix: gate every shipped JSON asset on the schema, and stop themes failing silently

  CI validated `examples/` and nothing else, so anything outside it drifted unchecked: all five bundled DOCX themes had shipped `componentDefaults.table` props the schema rejects (fixed by hand in the previous release, with nothing to stop it recurring), and the playground's "new theme" scaffold was born with 28 validation errors. This adds the missing gate and removes the fallbacks that hid the failures.

  **`pnpm validate:assets` validates every shipped asset, and CI runs it.** Every `*.docx.json`, `*.pptx.json`, `*.docx.theme.json` and `*.pptx.theme.json` under `packages/` and `examples/` — bundled themes, document templates, playground decks — plus every full document sample in `docs/**/*.md`. Docs snippets that are deliberately invalid opt out with `<!-- jto-validate: skip -- reason -->` on the line above the fence; a theme snippet opts in with `<!-- jto-validate: docx-theme -->`. Skipped samples are listed in the output rather than passing quietly.

  **`createMinimalTheme()` moved to `@json-to-office/shared-docx` and is now schema-valid.** It sat next to the parser in `core-docx` and emitted colours without the `#` prefix that `HexColorSchema` requires, so the one helper meant to produce a valid starting theme produced an invalid one. It now lives beside `ThemeConfigSchema`, returns `Static<typeof ThemeConfigSchema>` so a new required property breaks the build, and takes an optional name: `createMinimalTheme('house-style')` sets both `name` and a title-cased `displayName`. `core-docx` re-exports it, so `import { createMinimalTheme } from '@json-to-office/core-docx'` is unchanged.

  **The playground scaffolds new DOCX themes from it.** Creating a theme used to write a hardcoded literal with 5 colours, 2 font roles and no metadata — 28 errors the moment the editor opened it. New themes are now valid on creation. PPTX scaffolding is unchanged; it already matched its schema.

  **A failed template copy no longer falls back to the scaffold.** If `/api/discovery/…/content` failed or had not resolved, the create dialog wrote the default scaffold with only a `console.error`, producing a file named after the template you picked and containing none of it. It now reports the failure and leaves the dialog open. Switching templates also clears the previous one's content, so submitting mid-fetch can no longer write the theme you just navigated away from.

  **`apex` and `devportal` are statically imported like the other three themes.** They existed only via a filesystem scan of `dist/`, so which themes were available depended on build state: a stale `dist` served the old broken copies, and a missing one degraded to `minimal` without a word. The scan remains for genuinely external themes, but now validates before registering instead of trusting whatever it reads.

  **An unresolvable theme name warns instead of silently rendering as `minimal`.** `props.theme` is an unconstrained string and unknown names fell back to `minimal` with no signal — a typo, or a `--theme-path` file whose internal `name` differs from its filename, produced a plausible document in the wrong theme. Generation now emits a `theme_not_found` warning naming what was requested and what is available, and the CLI prints it. The fallback itself is unchanged: a bad name still renders rather than failing. `validateTheme` also stops casting unregistered theme names straight through, and rejects them with the list of valid names.

  The CLI now forwards structured generation warnings from the DOCX pipeline to the terminal generally, not just this one — they were collected and dropped before.

### Patch Changes

- Updated dependencies [cd2f5f4]
  - @json-to-office/shared-docx@0.23.0
  - @json-to-office/core-docx@0.23.0
  - @json-to-office/jto-cli@0.23.0

## 0.22.0

### Minor Changes

- e311268: fix(cli): honour `PORT` in `jto dev`, and drop the dev-server config keys nothing read

  `PORT` was parsed in two places and read in neither: the dev server took its port from `-p`, the config file, or a `server.port === 3003` sentinel that stood in for "the user did not choose a port". The sentinel could not tell an untouched default from a deliberate `3003`, so `jto pptx dev` with `PORT=3003` — or with `"server.port": 3003` in the config file — bound 3004 instead.

  - `loadConfig` resolves the port in one place: config file > `PORT` > the caller's default > the packaged `3003`. `dev -p` still outranks all of them.
  - `loadConfig` takes an optional second argument (`{ defaultPort }`), so `dev` supplies the format's port instead of the loader emitting a magic value the caller has to recognise. The parameter is optional and existing call sites keep working.
  - The returned config is a fresh `structuredClone` of the defaults on every load, including the failure path. `dev -p` writes straight into `config.server.port`, which used to mutate the shared module-level `defaultConfig`, leaking one command's port into every later load in the same process.
  - A config file that fails schema validation still falls back to defaults, but the fallback now honours `PORT` and the caller's default rather than always returning `3003`.
  - The dev-server config schema keeps only what the dev server reads (`mode`, `server.port`, `server.host`, `development.hmrPort`). `server.cors.*`, `api.*`, `playground.*`, `paths.*`, and `development.hmr` / `sourceMap` / `verbose` are gone rather than left to imply an effect they never had. Unknown keys still validate, so a config file that still carries them keeps loading and they keep being ignored. CORS is configured through `CORS_ORIGIN`.
  - `jto`'s server config no longer parses `PORT` and `UPLOAD_DIR` into an object nobody consulted; the listener's port comes from the CLI config above.

  **Behaviour changes to expect when upgrading:**

  - **`PORT` now decides the dev-server port** when `-p` is absent and the config file sets no `server.port`. A deployment that exports `PORT` for some other process and previously landed on 3003/3004 will now bind `$PORT`. Pin the port with `-p` or `server.port` if you need the old value.
  - **`PORT=3003 jto pptx dev` binds 3003**, not 3004.

  Port parsing is strict: `Number.parseInt` stops at the first non-digit, so `PORT=8080x` used to bind 8080. Both `PORT` and `--port` now require a complete integer in range, and an invalid `--port` fails with a clear message instead of silently binding elsewhere. `loadConfig` also survives a malformed config file — a top-level `null`, or `"server": null`, previously threw while computing the fallback port and skipped the warn-and-default path that exists for exactly that case.

### Patch Changes

- Updated dependencies [e311268]
- Updated dependencies [e311268]
- Updated dependencies [e311268]
- Updated dependencies [e311268]
- Updated dependencies [e311268]
- Updated dependencies [e311268]
- Updated dependencies [e311268]
- Updated dependencies [e311268]
- Updated dependencies [e311268]
- Updated dependencies [e311268]
  - @json-to-office/shared@0.22.0
  - @json-to-office/shared-docx@0.22.0
  - @json-to-office/core-docx@0.22.0
  - @json-to-office/core-pptx@0.22.0
  - @json-to-office/jto-cli@0.22.0
  - @json-to-office/shared-pptx@0.22.0

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
  - @json-to-office/core-pptx@0.21.0
  - @json-to-office/jto-cli@0.21.0
  - @json-to-office/shared-docx@0.21.0
  - @json-to-office/shared-pptx@0.21.0
  - @json-to-office/shared@0.21.0

## 0.20.0

### Patch Changes

- Updated dependencies [bc15ebf]
- Updated dependencies [bc15ebf]
- Updated dependencies [de4d21c]
  - @json-to-office/core-pptx@0.20.0
  - @json-to-office/core-docx@0.20.0
  - @json-to-office/shared-pptx@0.20.0
  - @json-to-office/jto-cli@0.20.0
  - @json-to-office/shared-docx@0.20.0

## 0.19.0

### Patch Changes

- Updated dependencies [a332658]
  - @json-to-office/shared-docx@0.19.0
  - @json-to-office/shared-pptx@0.19.0
  - @json-to-office/core-docx@0.19.0
  - @json-to-office/core-pptx@0.19.0
  - @json-to-office/jto-cli@0.19.0

## 0.18.0

### Patch Changes

- Updated dependencies [a079015]
- Updated dependencies [71faefc]
  - @json-to-office/core-docx@0.18.0
  - @json-to-office/shared-docx@0.18.0
  - @json-to-office/core-pptx@0.18.0
  - @json-to-office/shared-pptx@0.18.0
  - @json-to-office/jto-cli@0.18.0

## 0.17.2

### Patch Changes

- f379ba0: fix(playground): expand collapsed long-string sentinels before preview/build

  The long-string collapser rewrites the Monaco model text, replacing a value's hidden middle with a `§jtoc:<id>§` sentinel that only `toStorageValue()` restores. The save path called it, but the Run/preview path (`preview:flushAndBuild`) read `editor.getValue()` raw at three points, leaking sentinels into the rendered document (and persisting them back into the store).

  The per-editor `toStorageValue` reconstructor is now exposed on the editor refs store and applied to every live-text read feeding `saveDocument`, `updateTheme`, and `buildDocument`.

  Copy and cut were leaking the sentinel too — the hidden `§jtoc:<id>§` is real model text, so a selection crossing a collapsed chip put the sentinel on the clipboard. `copy`/`cut` are now intercepted in the capture phase and the clipboard is rewritten with the reconstructed value (cut also deletes the selection).

## 0.17.0

### Minor Changes

- 743ee97: feat(playground): collapse very long JSON strings into clickable chips

  Long string values (base64 images, embedded SVGs, big data blobs) wrap into hundreds of rows with wordWrap on, making the editor unusable. The JSON editor now collapses the middle of any value over 200 chars into a hidden sentinel rendered as a clickable chip, keeping a visible head and tail (e.g. `"data:image/png;base64,iVBOR …⟨12.4 KB⟩… AAAA"`). Clicking the chip toggles expand/collapse.

  - In-place, same-line collapse keeps every other line number valid (validation markers, folding, minimap unaffected).
  - Lossless saves: the full document text is reconstructed before persisting; build/preview/export always see the real value.
  - Controlled-value save echoes are ignored so chips and the cursor never thrash while editing.
  - Escape-safe head/tail slicing so non-base64 strings never get cut mid-escape.
  - Validation markers that fall inside a collapsed chip are filtered out.

### Patch Changes

- Updated dependencies [542f8ad]
  - @json-to-office/shared-docx@0.17.0
  - @json-to-office/core-docx@0.17.0
  - @json-to-office/jto-cli@0.17.0

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
  - @json-to-office/jto-cli@0.16.0
  - @json-to-office/core-pptx@0.16.0
  - @json-to-office/shared-pptx@0.16.0

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
  - @json-to-office/jto-cli@0.15.0

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
  - @json-to-office/jto-cli@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [8744ad2]
- Updated dependencies [755d812]
  - @json-to-office/shared@0.13.0
  - @json-to-office/core-docx@0.13.0
  - @json-to-office/core-pptx@0.13.0
  - @json-to-office/jto-cli@0.13.0
  - @json-to-office/shared-docx@0.13.0
  - @json-to-office/shared-pptx@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [c4a57aa]
- Updated dependencies [c4a57aa]
  - @json-to-office/core-docx@0.12.0
  - @json-to-office/shared@0.12.0
  - @json-to-office/core-pptx@0.12.0
  - @json-to-office/jto-cli@0.12.0
  - @json-to-office/shared-docx@0.12.0
  - @json-to-office/shared-pptx@0.12.0

## 0.11.2

### Patch Changes

- 77e3085: Add Alternative deck and Brand template pptx samples; show template title/description on a second line in the playground document picker; allow select trigger to wrap long values.

## 0.11.0

### Minor Changes

- 7f9679b: Introduce `@json-to-office/jto-cli`, a lightweight CLI package containing only the non-playground commands (`generate`, `validate`, `schemas`, `discover`, `init`, `fonts`). Install it instead of `@json-to-office/jto` in CI or scripting contexts to skip the React/Monaco/Vite/AI-SDK playground deps.

  `@json-to-office/jto` is unchanged for users — it now depends on `jto-cli` and adds the `dev` playground command on top, so `jto docx dev` / `jto pptx dev` still work as before.

  Note: the binary in `@json-to-office/jto-cli` is `jto-cli`, not `jto` — update CI scripts that previously invoked `jto` accordingly.

### Patch Changes

- Updated dependencies [7f9679b]
  - @json-to-office/jto-cli@0.11.0

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
  - @json-to-office/shared-pptx@0.9.0
  - @json-to-office/core-docx@0.9.0
  - @json-to-office/core-pptx@0.9.0

## 0.8.3

### Patch Changes

- 6e45a99: fix: sanitize theme key to prevent prototype pollution and guard against undefined themes

## 0.8.2

### Patch Changes

- a5e4e91: Fix Windows build: replace shell-escaped inline Node scripts with cross-platform path.join

## 0.8.1

### Patch Changes

- 2224cfd: Auto-wrap raw document JSON body and include paths in validation errors; replace shell cp with cross-platform Node.js equivalents

## 0.8.0

### Patch Changes

- Updated dependencies [b1af6ef]
  - @json-to-office/core-docx@0.8.0
  - @json-to-office/shared-docx@0.8.0
  - @json-to-office/core-pptx@0.8.0
  - @json-to-office/shared-pptx@0.8.0
  - @json-to-office/shared@0.8.0

## 0.7.0

### Minor Changes

- c0bd927: Add generator-level services config for Highcharts export server endpoint and auth headers

### Patch Changes

- Updated dependencies [c0bd927]
  - @json-to-office/shared@0.7.0
  - @json-to-office/core-docx@0.7.0
  - @json-to-office/core-pptx@0.7.0
  - @json-to-office/shared-docx@0.7.0
  - @json-to-office/shared-pptx@0.7.0

## 0.6.0

### Patch Changes

- 84299d3: Remove placeholder header/footer component types and exports. Centralize image type detection and ImageRun construction. Support percentage strings (e.g., "50%") for floating position offsets and wrap margins, resolved against page or available dimensions. Fix table cell backgroundColor defaulting to transparent when unset.
- Updated dependencies [84299d3]
  - @json-to-office/shared-docx@0.6.0
  - @json-to-office/core-docx@0.6.0

## 0.5.3

### Patch Changes

- a89a7cc: feat: use Monaco built-in JSON schema validation for theme editor

  Replace custom `validateThemeJson` marker-setting with Monaco's native `onValidate`, add ValidationPanel/StatusBar UI, and tighten theme schemas with `additionalProperties: false`.

- Updated dependencies [a89a7cc]
  - @json-to-office/shared-docx@0.5.3

## 0.5.2

### Patch Changes

- 662bef5: feat: default to LibreOffice renderer in both docx and pptx playgrounds, add fidelity warning for docxjs

## 0.5.1

### Patch Changes

- 7ae10c1: Improve sidebar collapsed state UX: faster expand/collapse animation (300ms simultaneous vs 450ms sequential), wider collapsed rail (48px), 2-char doc badges, distinguishable theme badges, tooltip on add buttons, and accessibility attributes.

## 0.5.0

### Minor Changes

- bcd6237: feat(jto): add AI feature flag (AI_ENABLED / VITE_AI_ENABLED env vars), fix prod static serving, respect NODE_ENV for config mode, add Render blueprint for DOCX + PPTX deployment
- b34970d: feat: upgrade JSON template examples to Wiseair-level quality

  - Rewrite proposal (apex theme), technical-guide (devportal theme), invoice (modern table styling)
  - Replace Charts Demo with Lumina Analytics deck (39K, 15 slides, all native chart types, grid + templates + decorative shapes)
  - Rewrite pitch-deck as Meridian Series B (29K, 9 slides, grid + templates + decorative shapes)
  - Add 4 custom themes: apex, devportal (DOCX), lumina, meridian (PPTX)
  - Modern table styling: hide vertical inside borders, cell padding, headerCellDefaults
  - Delete 7 low-quality templates: Sales Deck, Company Branding, Product Launch, Dashboard, Charts Demo, quarterly-report, annual-review
  - Remove quarterlyReportExample export from core-docx

### Patch Changes

- 9972863: fix(jto): reinforce `{ name, props }` component format in all PPTX AI prompts to prevent non-compliant template output
- Updated dependencies [b34970d]
  - @json-to-office/core-docx@0.5.0

## 0.4.1

### Patch Changes

- 5b07742: Auto-detect LibreOffice on Windows default install paths

## 0.3.6

### Patch Changes

- 985ac6c: Add explicit "no tools" instruction to AI system prompt so the model outputs JSON directly instead of complaining about missing file-editing tools.

## 0.3.5

### Patch Changes

- 8e99808: Upgrade ai 6.0.116→6.0.141, @ai-sdk/react 3.0.118→3.0.143, ai-sdk-provider-claude-code 3.4.3→3.4.4 to fix stream validation crash on tool-output-available events with providerMetadata.

## 0.3.4

### Patch Changes

- 411fa3e: Disable filesystem tools (Read, Write, Edit, Glob, Grep, Bash, Agent) in AI chat provider to prevent crash when Claude Code autonomously reads large files. Also disable session persistence and improve error detection for oversized requests.

## 0.3.3

### Patch Changes

- ce2016f: fix(jto): include prompt .md files in published package via tsup onSuccess copy
- 3553ec5: fix(jto): always show add buttons for documents and themes in sidebar

## 0.3.2

### Patch Changes

- e96c957: Upgrade Radix UI dependencies and fix vite manualChunks to scope matching to node_modules

## 0.3.0

### Patch Changes

- de674e0: feat(schema): per-container narrowed children validation for DOCX and PPTX

  Each container component now declares its `allowedChildren`, and the schema
  generator builds per-container children unions instead of one flat recursive
  union. Monaco immediately flags invalid nesting (e.g. heading inside docx).

  Also skips auto-builds when JSON is syntactically invalid or has schema
  validation errors, preventing wasted server roundtrips during typing.

- Updated dependencies [de674e0]
  - @json-to-office/shared-docx@0.3.0
  - @json-to-office/shared-pptx@0.3.0
  - @json-to-office/core-docx@0.3.0
  - @json-to-office/core-pptx@0.3.0

## 0.2.1

### Patch Changes

- 94314f8: Redesign plugin sidebar UX: inline Switch toggles, active/inactive state, split-pane detail modal

## 0.2.0

### Minor Changes

- 1db99a3: Extract shared plugin infrastructure from core-docx into shared package and add plugin system for PPTX generation

### Patch Changes

- Updated dependencies [1db99a3]
  - @json-to-office/shared@0.2.0
  - @json-to-office/core-pptx@0.2.0
  - @json-to-office/core-docx@0.2.0
  - @json-to-office/shared-docx@0.2.0
  - @json-to-office/shared-pptx@0.2.0
