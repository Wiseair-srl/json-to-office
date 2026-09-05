# @json-to-office/jto

## 2.4.0

### Patch Changes

- 97ebe60: Fixes the playground's quality-rule table, which had drifted sixteen rules behind the engine, and adds the guard its header had been asking for.

  `quality-rules.ts` mirrors the shipped rules so the policy editor can complete and validate them. It listed 6 of 22: everything added since the original five — contrast, box overlap, placeholder text, the SVG and line-box checks, font count, palette adherence, and the new chart and table rules — was absent from both formats.

  Its header called that "a wrong hint, never a wrong analysis", and that was true of a wrong entry and wrong about a missing one. `parseQualityPolicy` refuses any rule id the table does not list, so a policy naming one of the sixteen came back `Unknown rule "pptx/box-overlap"` and never reached the server, which would have run it happily. The header now says so.

  Every rule is mirrored, in its own pack's order so the two files read side by side, with each rule's real `defaultParameters` — the WCAG ratios behind `pptx/text-contrast`, the overlap floors, the 1.08 width tolerance that is the measured error of the DOCX width model, and the chart and table limits.

  A new test compares the table against `DOCX_QUALITY_RULES` and `PPTX_QUALITY_RULES` on ids and order, category and default severity, and parameter names and default values, and checks that a policy naming any shipped rule parses. A parameter of a type the mirror cannot describe fails it too, rather than going quietly undocumented.

- Updated dependencies [ed3a991]
- Updated dependencies [22f6f3e]
- Updated dependencies [c22a911]
- Updated dependencies [4526e5a]
- Updated dependencies [102d8a2]
  - @json-to-office/quality@2.4.0
  - @json-to-office/core-docx@2.4.0
  - @json-to-office/core-pptx@2.4.0
  - @json-to-office/shared-pptx@2.4.0

## 2.3.1

### Patch Changes

- 1b070a9: The editor stops flagging a browser plugin's component as an unknown `name`.

  Every event that can change the component set fires its own schema refresh: each plugin that finishes compiling, each disk-plugin toggle, the editor mounting. On a page holding a few browser plugins that is several requests in flight at once, each carrying a different view of the plugins — and each answering with megabytes of JSON, so they do not come back in the order they were sent. Whichever answer arrived last was installed, newest or not. When an older one arrived late, Monaco was left validating against a schema built before the newest plugin existed, and the component the sidebar showed as Ready read as `Value is not accepted. Valid values: …` in the document — permanently, until a toggle or an edit forced another refresh. The margin was routinely single-digit milliseconds, so which plugins survived a page load was luck. Renaming a component is the reliable way to lose the race: the recompile it triggers refreshes on top of whatever is still in flight.

  A refresh now installs its result only if no newer refresh has started since, on the failure path as well — a request that fails late no longer rolls a newer schema back to the plugin-free defaults. Identical requests that are still in flight also share one response, which is what the schema cache behind them could never do: it is empty until the first answer lands, and the duplicates all start before that.

  That sharing needed the two reasons a schema is re-fetched to stop being the same call. Wanting an answer that is not a stored one — which every Monaco refresh wants, because the cache key cannot see a plugin rebuilt on disk under an unchanged name — is now `bypassCache`, and a request already on the wire for that exact key is still the answer being asked for. Declaring the server's answer stale stays `clearPluginSchemaCache`, and now reaches requests in flight as well: they were sent against the state just declared stale, so they are no longer handed to callers that ask after that point, and their answers no longer reach the cache.

## 2.3.0

### Patch Changes

- b73f62f: `/validate` knows the plugin components the rest of the server knows.

  The dev server's `POST /api/<format>/validate` validated against the standard components alone, so a document naming a registered plugin came back `Unknown component "weather"` — the same name the schema route had just offered for completion and the generator would have expanded happily. The route now hands the registered components to the plugin-aware validator, which defers those nodes from the standard walk and checks each one's props against the version it resolves to. With no plugins registered nothing changes: `weather` is still unknown, which is the honest answer from a server that cannot build it either.

  Doing that exposed a second defect, in `core-docx`'s plugin validator itself: its walk returned at the first node that was not a custom component instead of descending, so it only ever checked components at the top level. A plugin component inside a `section` — every real document — was never validated against its props schema, by this route or by the pre-generation gate; `city: 123` passed both and failed later inside the component's own render. It now descends whatever the node is, matching what `core-pptx` already did. Custom components carried in props rather than `children` (a header, a table cell) are still outside this pass.

  `FormatAdapter` gains an optional `validateDocumentWithPlugins(doc, plugins)`, async because the core that owns the plugin-aware validators is imported on demand. Callers with an empty registry keep using the sync `validateDocument`.

- Updated dependencies [b73f62f]
  - @json-to-office/core-docx@2.3.0

## 2.2.0

### Minor Changes

- de08c13: Disk plugins reach hosted playgrounds again, behind `PLUGIN_AUTOLOAD`.

  Loading a plugin means importing code the server found by walking its own filesystem, so in production no request may trigger it: the load route wants an API key, and a public playground — running `API_AUTH_MODE=disabled` precisely because a browser cannot keep one — has none to send. The rail listed the bundled plugins anyway, with a switch that changed nothing: `weather` completed, validated and rendered locally, and on the deployment the same document came back `Unknown component "weather"`, with no completion for the name.

  `PLUGIN_AUTOLOAD=true` is the operator granting it once, at boot, for the image's own filesystem — a different act from a caller provoking a filesystem scan, which stays refused however the flag is set. The server now preloads what it finds before it takes its first request, so nothing a request carries has to reach the disk: on-demand schema generation and the keyless `POST /discovery/load-plugins` bootstrap remain local-only, as they were. The flag defaults to on in `development` and `test` and off otherwise — a mislabelled `staging` gets the hardened default, like every other setting here — so local development is unchanged. Both hosted playgrounds in `render.yaml` set it.

  The playground no longer fires that bootstrap POST at all. Its work is the preload's now, and firing it only gave a keyless deployment a 401 to log and the first schema fetch a race to lose.

  Where it is off, the rail says so: disk plugins are still listed and still open their details — the name, the description and the props are worth reading — but their switches are disabled under a line explaining that this server does not load plugins from disk. Browser plugins are unaffected either way; their schemas are composed from what the client sends, and the server never runs them.

  Also fixes the plugin count in that eyebrow. It read `active/total` where `active` came from a persisted selection nothing ever pruned, so names of plugins the project no longer has kept counting — three of them against one discovered plugin read `3/1`. Both halves are now counted over the plugins that actually exist, and over all of them rather than the ones a filter left standing.

## 2.1.0

### Minor Changes

- 4a5c33f: Playground: a browser plugin editor and a visual theme editor, for both DOCX and PPTX.

  **Custom plugins in the browser.** `Plugins ▸ +` creates a `*.component.ts` file next to your documents, seeded with a starter component (or a renamed copy of a plugin on disk). It opens in a TypeScript editor wired to the real `@sinclair/typebox` and plugin API declarations, recompiles on every pause, and once ready joins the document schema (completions, validation) and every build. Plugin code is compiled in the page and run in a Web Worker inside a sandboxed, opaque-origin `<iframe>` with a Content Security Policy — no page, no cookies, no storage, hard time and size limits, and no network beyond the hosts you list against that plugin (the switch alone grants nothing; `connect-src` names those hosts and refuses everything else) — and expanded into standard components before any document leaves the browser; the server never executes it. Applies to Run, the quality analysis (findings are mapped back to the authored document), Compare, "Copy standard components" and downloads. Run waits for pending compiles; a document that names a disabled or broken plugin fails with a message naming the file.

  **Visual theme editor.** A theme tab opens as a form generated from the format's theme schema: colours through a picker (saturation square, hue rail, eyedropper, and the theme's own tokens as one-click references) with contrast ratios; a searchable font combobox over the safe and Google families, with the full picker one click further; page geometry in real units (DOCX); every named style with its fields, booleans as **Unset · Off · On** so an inherited value is distinct from an overridden `false`. The whole tab is form: the **Visual · JSON** switch sits in the app header while a theme is open, and the sample floats over the preview from a **Theme sample** button in the status row, repainting on each edit without moving the field being typed in. **Run sample**, in that drawer, renders a document exercising the theme through the ordinary generate + preview pipeline (as `Sample · <theme>`; Run on the theme tab refreshes it). Both views edit the same file; keys the form does not cover are preserved and listed under Advanced. Identity shows which open documents use the theme and flags a duplicate name.

  Server: `GET /api/discovery/themes/builtin` (built-in themes by value), `POST /api/discovery/schemas/document` (composes browser plugin schemas next to disk plugins; capped, rate-limited, `$id`s namespaced), `GET /api/discovery/plugins/:name/source` (same-site only; start a browser plugin from a disk one).

### Patch Changes

- Updated dependencies [3c290f6]
  - @json-to-office/core-docx@2.1.0
  - @json-to-office/core-pptx@2.1.0

## 2.0.0

### Patch Changes

- 2d1a10b: The bundled DOCX theme set is now `minimal`, `devportal`, `vermilion`.

  `corporate`, `apex` and `modern` are removed, along with the exported
  `corporateTheme` and `modernTheme` consts (`devportalTheme` and
  `vermilionTheme` are exported instead). A document naming a removed theme
  falls back to `minimal` with the existing `W_UNKNOWN_THEME` warning; to keep
  one of the removed looks, copy its last shipped JSON into your own theme file
  and load it with `--theme-path` / `customThemes`.

  The three surviving themes set their `mono` font role to Courier New. Every
  family they name — Helvetica, Arial, Calibri, Courier New — has a
  metric-compatible substitute in the hosted playground's LibreOffice preview
  (Liberation Sans, Carlito, Liberation Mono), so the PDF preview breaks lines
  where Word does; Menlo and Consolas, the previous mono roles, fall back to
  DejaVu Sans Mono with different advance widths.

  `vermilion` now ships `componentDefaults` — the `vermilion-annual-report`
  table recipe (gray hairline rows, open sides, full width, red bold headers
  over a red hairline, 9.5pt cells with roomy padding) plus em-dash list
  markers, centered images/statistics and `section.pageBreak: false` — so a
  bare table on `vermilion` looks like the annual report instead of a default
  grid.

  Tables also breathe: a body paragraph or list item directly above a table now
  keeps at least 12pt of space before the table's top rule (a stated
  `spacing.after` still wins), and the last item of a list no longer inherits
  the inter-item gap — it falls back to the body style's space-after, so lists
  stop ending a couple of points before whatever follows.

  The two shipped example documents were replaced, and the themes now carry
  their looks outright. `proposal` and `technical-guide` gave way to
  `practice-note` — a single-column Atelier Still note — and `field-review` — a
  two-column Northstar editorial with column breaks, pull quotes and a
  scorecard table. Their palettes and type were folded into the themes:
  `minimal` is now Calibri with sage-green ink on ivory, `devportal`
  (displayName "Field Editorial") is Helvetica in near-black ink with a
  burnt-orange accent, and both examples state `props.theme` and no
  `themeOverrides` at all. The exported `proposalExample`/
  `technicalGuideExample` loaders are now `practiceNoteExample`/
  `fieldReviewExample`, and the `-t proposal` / `-t technical-guide` CLI
  template names are now `-t practice-note` / `-t field-review`.

  A table where no column declares a `header` no longer emits an empty header
  row — previously an invisible phantom that any theme header fill would
  suddenly paint as a bare tinted band.

  The playground templates and remaining documents no longer restate
  values their theme already provides (table borders and recipe, list markers,
  image alignment, first-section page breaks, a background color override) —
  verified byte-identical before and after.

- Updated dependencies [2d1a10b]
  - @json-to-office/core-docx@2.0.0
  - @json-to-office/shared-docx@2.0.0
  - @json-to-office/jto-cli@2.0.0

## 1.11.1

### Patch Changes

- bbb46fc: The preview now fetches a bold face for documents that ask for bold with
  `bold: true`.

  `collectReferencedWeights` narrows what the LibreOffice preview fetches to the
  weights a document actually uses, but it only counted numeric `fontWeight`
  values. `bold: true` is shorthand for `fontWeight: 700` — the schema says so and
  the compiler resolves it that way — so a document that mixes the two lost its
  bold face: referencing any numeric weight took it off the "no explicit weights"
  fallback of {400, 700}, and nothing put 700 back. The bold runs then asked the
  host for a face that was never staged, which renders as Inter on a machine with
  Inter installed and as a fallback anywhere else — the preview container ships
  only Liberation/Carlito/Caladea/DejaVu.

  `bold: true` now counts as a reference to 700, with the compiler's own
  precedence: a font that sets both takes the numeric weight, and its `bold` says
  nothing about which face is wanted. `modern-annual-report-1` goes from fetching
  Inter {400, 500, 600} to {400, 500, 600, 700}; that extra face per bold-using
  family and cold cache is the cost of the bold text rendering at all.

- Updated dependencies [bbb46fc]
  - @json-to-office/shared@1.11.1

## 1.11.0

### Minor Changes

- 3bfa61f: Inline SVG no longer dominates the cost of rendering a DOCX, and the raster
  fallback it produces can be turned off.

  Every inline SVG ships twice: the vector, which Word 2016+ and LibreOffice
  draw, and a PNG in the `fallback` slot for readers older than that. The
  fallback was rasterized one image at a time, which cost about 250ms each and
  went unnoticed while a document held a couple of dozen SVGs. Splitting the
  stock templates' page decoration into a component per motif took several of
  them past two hundred, and generation went from six seconds to seventy-seven.

  Two changes, and the second is the one that matters:

  - Rasters are produced through resvg's `renderAsync` and in a bounded batch
    rather than a serial loop. `Resvg.render()` is synchronous native code, so
    awaiting it never yields — a batch started concurrently still ran one at a
    time on the main thread, which is why simply starting them together changed
    nothing. `renderAsync` hands each raster to libuv's threadpool instead, worth
    roughly 30% (`standard-annual-report` 76.5s → 54.6s). Concurrency is capped at
    eight so the peak stays within the hosted container's memory, each raster
    already being held to a megapixel.
  - `svgRasterFallback: false` — `--no-svg-fallback` on the CLI — skips the raster
    altogether. That is the difference between 76.5s and **2.1s**, and it halves
    the package (1.10 MB → 0.57 MB), because the bulk of an artwork-heavy DOCX is
    fallback PNGs nothing modern ever draws. Rendered output is byte-identical
    through LibreOffice with the flag on or off; the vector is what gets drawn
    either way. docx.js requires the slot to be filled, so the vector bytes go in
    it — the same thing already shipped when a raster could not be produced — and
    only readers old enough to need the raster lose the image. Default is
    unchanged, so no existing output moves.

  Both preview paths take the opt-out, because a preview's answer is a PDF or a
  PNG and LibreOffice draws the vector to make it: the playground's
  `/preview/libreoffice-from-json` and the MCP server's `jto_preview`. Measured
  against the running playground, the stock templates went from 47-62s per
  preview to 5-8s, byte-identical PDFs. Downloads keep the fallback, since those
  bytes go to a reader that may be older than Word 2016.

  Corpus goldens digest every byte and none moved, which is also the check that
  `renderAsync` produces the same PNG as `render()`.

- 3bfa61f: Every stock DOCX template now draws its page decoration as one component per
  motif instead of one page-sized rendering.

  Each page carried a single page-sized SVG — or, in the `modern-annual-report-2`
  and `-3` covers, a single page-sized pptx slide rasterized to PNG — with every
  unrelated mark baked into it: a background wash, a diagonal hatch field, a lens
  motif, hairline rules. Those are now separate, individually placed components,
  which is what makes them addressable as data rather than as one opaque asset.

  Four things shaped how far the split could go:

  - `zIndex: 0` is not "unset". docx.js reads it as absent and derives
    `relativeHeight` from the image height, which put the full-page backdrop on
    top of the artwork it backs. Every motif now states an equal, non-zero
    `zIndex`: Word stacks by `relativeHeight`, LibreOffice ignores it and uses
    document order, and equal values are the one arrangement both agree on.
  - Each floating drawing costs an anchor paragraph and the schema exposes no line
    height to zero it, so 269 of them pushed `standard-annual-report` from 20
    pages to 25. Page decoration therefore lives in the section header, which
    holds the same page-relative offsets and takes no part in the body flow. Every
    section needs one — a section without a header inherits the previous
    section's, which painted one page's decoration across the next.
  - A `visual` rasterizes to opaque RGB, so its pieces may not overlap.
    `modern-annual-report-3` splits into non-overlapping clusters.
    `modern-annual-report-2`, whose every page sits on a full-canvas backdrop,
    could not — so its `rect`/`roundRect`/`ellipse`/`line`/`pie` elements are
    reauthored as inline SVG, which is transparent, and 23 of its 25 pages no
    longer need the pptx rasterizer at all. The two visuals carrying text stay
    visuals: SVG has no line wrapping.
  - PPTX has a real shape vocabulary, so `minimalist-pitch-deck`'s laptop mockup
    and chart gridlines are native shapes rather than pictures — editable in
    PowerPoint instead of flattened.

  Verified against a pre-change render of all nine templates: page counts
  unchanged and nothing solid moves. Exact pixel equality is not reachable and was
  not claimed — LibreOffice re-emits each embedded SVG through its own 1/100 mm
  grid, so hairline anti-aliasing lands differently; the check is an eroded diff
  mask, which keeps a mark that moved and discards a hairline that shifted a
  fraction of a pixel.

  Left alone deliberately: `management-plan`'s icons, since a six-path glyph is
  one mark rather than six, and `data-report-presentation`'s funnel, whose five
  polygons are irregular quadrilaterals tiling edge to edge where separate
  rasterizations would seam.

### Patch Changes

- Updated dependencies [5757874]
- Updated dependencies [64b7905]
- Updated dependencies [dd0240c]
- Updated dependencies [3bfa61f]
- Updated dependencies [c6f97a0]
  - @json-to-office/core-docx@1.11.0
  - @json-to-office/jto-cli@1.11.0

## 1.7.0

### Patch Changes

- 4b596aa: docx validation gets one source of truth for validity (#292). The deep walk's
  embedded-component positions (section header/footer, table cell content) are
  now declared on `STANDARD_COMPONENTS_REGISTRY` entries and the walk is driven
  from those declarations, with a test pinning them to the `createPropsSchema`
  factories that wire the same positions into the live document schema.

  The flip-to-valid rescue no longer fails open: when the whole-document check
  rejects and the walk finds nothing, the document is accepted only for the
  three audited false-reject classes (`allowUnknownFields`, documents that use a
  registered plugin component, and `allowedChildren` containment — verified
  precisely against a containment-relaxed schema); anything else now fails
  closed. Unknown or wrong-typed keys next to `name`/`props`/`children` (a
  `bogus: 1`, an `enabled: "yes"`) — previously accepted silently, even inside
  section headers — are rejected with a path-addressed error, and a new guard test
  sweeps every closed object position of every component's props asserting
  validate, validateStrict and generation agree on rejecting unknown keys.

  The jto server now reads the document title for filenames from
  `props.metadata.title` (docx) / `props.title` (pptx) instead of a root-level
  `metadata` that was never part of the schema — real playground documents had
  always fallen back to the generic filename. Because that is the first time
  user-authored text reaches the filename, the title is sanitized where the name
  is built: path separators and control characters are replaced and the length is
  capped, on both the generated and the cache-hit branch. The filename travels
  into the generate response and into the `Content-Disposition` of
  `/preview/*-from-json`, which interpolates it verbatim, so an unescaped CR/LF
  in a title would otherwise have split that header.

- e9c72fc: Hosted playground generation no longer 400s on bundled templates that ship
  their fonts as `fontRegistry` `kind:'file'` sources (vermilion-annual-report:
  "Unsafe outbound source ... local file sources are disabled for HTTP
  requests"). The template-media inliner — which already converted a discovered
  document's relative images to data URLs before safe-mode source validation —
  now also rewrites contained `{kind:'file', path}` font sources to
  `{kind:'data'}`, so the fonts pass the policy and travel to the remote
  rasterizer. Resolved font bytes are identical to the local file path, so the
  LibreOffice preview stages the same faces. A regression suite runs every
  bundled template through inlining + safe-mode validation against the
  render.yaml host allowlist.

  The playground also records template provenance (`templateSource`) when a
  discovered document is added, and sends it as `options.sourceName` instead of
  the display name — renaming a document created from a bundled template no
  longer breaks its media/font resolution.

- Updated dependencies [4b596aa]
- Updated dependencies [dc13fa7]
  - @json-to-office/shared-docx@1.7.0
  - @json-to-office/core-docx@1.7.0
  - @json-to-office/shared-pptx@1.7.0
  - @json-to-office/core-pptx@1.7.0

## 1.6.0

### Minor Changes

- 40ceaa4: New `vermilion-annual-report` gallery template — a 16-page A4 annual report
  (SVG page art, page-anchored floating text, real financial tables) with
  bundled Clash Display fonts declared through `fontRegistry` file sources — and
  a new bundled `vermilion` theme (poster-red / ink / creams). All runnable
  `examples/` and the shipped `proposal` and `technical-guide` templates are
  restyled onto it.

  Table cells also gain `font.lineSpacing` (single / atLeast / exactly / double
  / multiple), carried end to end — `exactly` pins the line height for dense rows —
  with an agreement test pinning that validate and generate accept the same
  documents.

### Patch Changes

- Updated dependencies [40ceaa4]
- Updated dependencies [40ceaa4]
- Updated dependencies [40ceaa4]
  - @json-to-office/core-docx@1.6.0
  - @json-to-office/shared@1.6.0
  - @json-to-office/shared-docx@1.6.0
  - @json-to-office/quality@1.6.0

## 1.5.0

### Minor Changes

- 9870128: Design quality becomes a first-class pipeline (#216, #218).

  Adds autonomous `@json-to-office/quality`: facts/rules/profiles/policy,
  certainty and evidence, suppressions, budgets, rule isolation, rich diagnostics,
  and explicit gates.

  DOCX/PPTX cores own preparation, authored-path provenance, facts, built-in rule
  packs, and five initial document-class profiles. Official adapters reuse one
  opaque `PreparedDocument` for analysis and rendering. Core entry points and
  format adapters expose the evidence-rich `QualityAnalysis` contract directly.

  CLI, MCP, HTTP, cache hits, and playground generation preserve rich quality
  diagnostics. Advisory remains default; profile/policy can block validation or
  generation before rendering. The executable 15-case reference corpus pins
  poor/professional/excellent verdicts and authored digests; the reference stock
  templates stay warning-clean apart from findings recorded as known-true.

  Estimator thresholds are calibrated against rendered ground truth: a new
  harness (jto-ops `test:ground-truth`) renders mutated stock templates through
  LibreOffice and scores predictions against exact PDF word geometry
  (`extractPdfTextGeometry`, exported from jto-ops). Calibration admits only
  top-aligned, unrotated boxes whose bottom-edge spill is directly comparable.
  The pptx text-fit `characterWidthFactor` moves 0.45 → 0.46 (the measured
  zero-false-warning optimum), pptx text facts gain box geometry, alignment,
  rotation, and compiler-aligned `autoFit`, and one stock template's undersized
  content slot — a measured 25pt real overflow — is fixed. Deterministic
  diagnostics now carry ready-made RFC 6902 `fixes`: fully specified table column
  rescaling, heading level repair, minimum font floor, and a fitting `fontSize`
  for estimated overflows when a size allowed by the active profile/policy fits.

  Three further rules close the gaps a dogfooding pass over the shipped templates
  exposed. DOCX had two active rules, neither about whether text fits, so five
  render defects scored clean: `docx/svg-text-bounds` reports a `<text>` baseline
  past its viewBox, which is never painted and leaves the PDF text layer with it;
  `docx/text-fit` reports a word too wide for its floating frame and a frame whose
  wrapped block runs off the sheet. Its width model sums per-character advances
  rather than applying one factor, since the same face measures 0.694 em/char for
  caps against 0.435 for lowercase, and it speaks only past an 8% overrun — the
  model's measured error against rendered geometry.

  `pptx/text-contrast` adds the accessibility axis, comparing each run against the
  surface actually behind it: its own fill, else the topmost earlier-drawn shape
  covering it, else the slide. Text under an image or chart yields no finding
  rather than a guess. Gradients are sampled at the text box, using a radius
  measured off a rendered slide — the last stop lands at half the bounding-box
  diagonal from the focus corner.

  The four legacy playground decks are removed, so the shipped set is exactly the
  reference corpus. Five render defects and three typos in the remaining templates
  are repaired, and 76 runs are recoloured to the ink that reads best at their
  worst point.

  `jto-cli` no longer truncates `--format json`: `process.exit()` in the same tick
  as a large write discarded whatever was still queued when stdout was a pipe, so
  output stopped at one pipe buffer and became invalid JSON, while a file redirect
  hid the bug entirely. All commands that terminate deliberately now flush first.

### Patch Changes

- Updated dependencies [9870128]
  - @json-to-office/core-pptx@1.5.0
  - @json-to-office/core-docx@1.5.0
  - @json-to-office/quality@1.5.0
  - @json-to-office/shared@1.5.0
  - @json-to-office/shared-pptx@1.5.0
  - @json-to-office/shared-docx@1.5.0
  - @json-to-office/jto-cli@1.5.0

## 1.2.0

### Patch Changes

- ad35065: Make the published PPTX schema and the PPTX validator ask for the same `props`. The generated document schema marked `props` required on every component, including `slide`, whose props are all optional — so `{ "name": "slide", "children": [...] }`, a slide that validates and renders, was flagged by every editor and agent reading that schema. In the other direction the deep validator accepted a bare `{ "name": "text" }`: `text` and `runs` are both optional fields, so an empty props object passed and a missing one passed with it, and the component that exists to draw content was allowed to carry none.

  Requiredness is now one answer per component, held in the registry and read by the schema generator and the deep walk alike: `slide` may omit `props`; every other PPTX component — the `pptx` root, `text`, `image`, `shape`, `table`, `highcharts`, `chart` — must carry it, and its absence is reported as `required_property` at that node's `/props` pointer instead of passing silently.

  **Behaviour change.** Documents that already write `props` everywhere are unaffected. Documents that omitted it on a `text` or an `image` are not: generation runs the deep validator, so those used to produce a file — a slide with nothing drawn on it — and now fail validation with a pointer to the node. That is the intended outcome for `text`, whose whole purpose is the content the key carries; `image` follows because the published schema has required `props` there since it was first generated, and reading the schema's own answer instead would have loosened that contract rather than fixed the disagreement. `image` remains half enforced: the missing key is caught, an empty `"props": {}` is not, since a sourceless image is an `IMAGE_NO_SOURCE` warning at generation rather than an error.

  Three smaller divergences on the same key close with it. `"props": null` was read as an omission by the nested walk — in both formats — while the schema typed the key as an object; it is now reported as a type error at the key it was written on. A slide's `placeholders` record accepted the whole component union, so a `slide`, or the `pptx` root, could sit in a title slot: placeholder values are narrowed to what a slide's `children` accept, in the schema and the walk together, and `jto_describe_component` now names those six components in the slot's schema instead of every component there is. And a registered plugin component may no longer omit `props`, which the published plugin branch has always required — the walk checks the key's presence and leaves its contents to the plugin layer, so the failure arrives as `required_property` at the node rather than as "expected object" from inside the plugin check.

  The generated schemas also declare `$schema` as `http://json-schema.org/draft-07/schema#`, draft-07's own `$id`. The previous `https://` spelling read as an unknown dialect, so a consumer had to rewrite the field or pass `validateSchema: false` before a stock Ajv would compile the schema at all.

  Released as a minor rather than a major deliberately: every document the validator starts rejecting was already invalid against the published JSON Schema for that component, so this brings the runtime into line with the contract it documents rather than changing that contract. The one contract that does change — `slide`'s `props` becoming optional — only accepts more.

- Updated dependencies [ad35065]
- Updated dependencies [ad35065]
- Updated dependencies [ad35065]
  - @json-to-office/core-pptx@1.2.0
  - @json-to-office/jto-cli@1.2.0
  - @json-to-office/shared-pptx@1.2.0
  - @json-to-office/shared-docx@1.2.0
  - @json-to-office/shared@1.2.0

## 1.0.0

### Patch Changes

- d145c9c: Remove the retired generic component-cache subpath and its unused public
  helpers. Renderer generation remains stateless; only document-output, asset,
  font and rasterizer caches remain.

  Rename the format-adapter reset hook from `clearComponentCache` to
  `resetCacheStats`, matching its remaining responsibility, and update the
  playground cache-clear message.

- Updated dependencies [cea7b6b]
- Updated dependencies [767552d]
- Updated dependencies [7319f5f]
- Updated dependencies [39b2ced]
- Updated dependencies [a05a152]
- Updated dependencies [d145c9c]
  - @json-to-office/core-docx@1.0.0
  - @json-to-office/shared@1.0.0
  - @json-to-office/core-pptx@1.0.0
  - @json-to-office/shared-docx@1.0.0
  - @json-to-office/shared-pptx@1.0.0
  - @json-to-office/jto-cli@1.0.0

## 0.38.1

### Patch Changes

- 8b73a8d: Cap the inline-SVG raster fallback by area, so a page of them cannot exhaust
  the renderer.

  `SVG_RASTER_SCALE` is applied to one edge, which says nothing about how big the
  bitmap gets: resvg renders RGBA, so a full-page SVG at 3x is 2382x3367 ≈ 8 MP ≈
  32 MB live. The annual-report templates carry two dozen page-sized SVGs, which
  took one render past 1.1 GB and had the hosted playground's container killed
  mid-request — the reader saw the proxy's HTML error page, not a document. The
  edge is now also capped so the whole bitmap stays within 1 MP, which keeps a
  full page near 120 DPI; only Word before 2016 ever draws this fallback, since
  everything newer draws the vector. Small SVGs are untouched.

  Report the failure in terms an author can act on. The playground parsed every
  generate response as JSON, so a proxy's HTML error page surfaced as
  `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`. It now reads the
  body only when it is JSON and, when it is not, names the likely cause — a
  502/503/504 says the server ran out of memory or restarted mid-request.

  Express the two `renderAs: "shape"` limits in the JSON Schema as well as in the
  deep validator. The validator only runs when a document is generated, so a
  shape missing its height was reported at Run; `if`/`then` puts the same rule
  where the editor can underline it while it is being typed.

- Updated dependencies [8b73a8d]
  - @json-to-office/core-docx@0.38.1
  - @json-to-office/shared-docx@0.38.1

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
