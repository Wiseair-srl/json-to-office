# @json-to-office/core-pptx

## 2.6.0

### Minor Changes

- 20e7cf2: `highcharts` output now inherits the document's typography (#354). The
  theme's body family goes on the chart, the heading family on the title, the
  `chartLabel` and `source` type roles (or a size one step under the body when
  the theme declares none) on axes, legend, data labels and credits, and the
  theme's text colours on all of them — beneath whatever the chart sets itself,
  property by property, so an explicit author value keeps winning exactly as
  `options.colors` does. Sizes are scaled to the width the image is placed at.
  A registered non-safe theme family is inlined as `@font-face` from the
  document's own font bytes ahead of any `resources.css`; a chart set in safe
  fonts posts the same request it always did.

### Patch Changes

- Updated dependencies [22a9f62]
- Updated dependencies [20e7cf2]
  - @json-to-office/quality@2.6.0
  - @json-to-office/shared@2.6.0

## 2.5.0

### Minor Changes

- 99b6ac8: Add shared palette, typography and canvas-spacing theme layers for DOCX and PPTX. Named roles compile into native styles, ordered chart palettes reach both chart paths, and quality checks recognize the extended colors. Fix DOCX theme font weights and support case formatting. Preserve existing theme defaults; chrome/motif recipes are schema contracts for later consumers.

### Patch Changes

- Updated dependencies [99b6ac8]
  - @json-to-office/shared@2.5.0
  - @json-to-office/shared-pptx@2.5.0

## 2.4.1

### Patch Changes

- 71c81aa: Adds the bundled-theme schema guard PPTX never had.

  DOCX has validated its bundled themes since they shipped dead `componentDefaults.table` properties that no renderer read and the validator rejects. PPTX had no equivalent, and needs one more than DOCX does: its themes are TypeScript object literals rather than JSON files, so nothing ever ran them past `ThemeConfigSchema` — `tsc` checks them against the hand-written `PptxThemeConfig` interface, which is a different thing and has drifted before.

  The timing is the point. `ir/compiler.ts` reads `ctx.theme.defaults.fontSize` unguarded, so a theme the schema would have rejected surfaces as a TypeError deep in the compiler rather than as a diagnostic naming the field. Survivable while three hand-written themes are the whole set; not survivable once themes carry type ladders, spacing scales and chrome recipes.

  Each theme is validated as a literal and again after a JSON round trip, since `undefined` members vanish on the way and that is how an optional property that is secretly required goes unnoticed. The registry is checked too: `getPptxTheme` falls back to the default on a miss, so a theme whose `name` disagrees with its key is a lookup that silently returns something else wearing the wrong label.

- f8034c6: Fixes four defects in the eval harness and tightens the pptx theme-lookup test, all found by review on #357.

  `buildFingerprint` recorded only each package's `dist/index.js`, but `tsup` builds `cli` and `index` as separate entries and a run executes `mcp-server/dist/cli.js`. A CLI-only rebuild therefore left the fingerprint unchanged — invisible to the one check whose entire job is noticing that the compiled product moved under a measurement. It now covers every top-level `dist/*.js`.

  The rejudge CLI read an option's value as its positional argument: `--scorecard out/sc.json runs/foo` resolved a runs directory of `out/sc.json`, joined `runs` onto it and wrote `rejudge.json` inside it — a documented invocation producing nothing, or ENOTDIR when the value is a file.

  Its two counts disagreed with each other about the same document. A run whose stored judgement carried no `wouldShip` satisfied both predicates, because `undefined !== true` is a change, and printed "1 document(s) re-judged, unchanged since; 1 changed their wouldShip answer". Both counts now require an original verdict, exactly as the `pairs()` helper already did.

  `summarise` built an agreement report for `level` and `genericness` even when no stored verdict carried them. `bootstrapKappa([])` answers `n: 0, rawAgreement: 0, kappa: NaN`, which serialises to `null` and prints as "NaN" — a missing measurement wearing the shape of a measurement. Those fields are now omitted, and the CLI says so.

  The new pptx bundled-theme test asserted only that `getPptxTheme(name)` returns something schema-valid, which a lookup returning the default theme for every name would satisfy. It now asserts identity against the registry.

## 2.4.0

### Minor Changes

- ed3a991: Adds information-design rules for charts and tables in both formats (#346).

  The baseline runs said what holds documents back, and it was not integrity: across the 25 briefs that shipped in neither condition, the judges kept returning to charts and tables with no units, no sources and no takeaways. `table` appears 117 times in those verdicts, `chart` 53. Ten new codes cover that ground, written once in `@json-to-office/quality` and translated by each format, so a slide chart, a document chart and a Highcharts config are judged by one standard rather than three.

  Charts: `W_QUALITY_CHART_3D` (a perspective projection distorts the comparison the chart exists for), `W_QUALITY_CHART_OVERLOADED` (past six slices or four series), `W_QUALITY_CHART_AXIS_BASELINE` (a bar axis off zero — only where the chart encodes with length, since zooming a line's axis is standard practice), `W_QUALITY_CHART_SERIES_COLORS` (the renderer's default palette belongs to no document; the fix names one theme token per series), `W_QUALITY_CHART_UNITS` and `W_QUALITY_CHART_ANNOTATION`, both advisory. The last is asked only of a chart that has somewhere to put the answer — a DOCX `caption`, a Highcharts `caption.text` — never of a native slide chart, which carries no such slot.

  Tables: `W_QUALITY_TABLE_NUMERIC_ALIGN` (digits line up by place value only when flush right; the fix right-aligns the column, header included), `W_QUALITY_TABLE_MIXED_DECIMALS`, `W_QUALITY_TABLE_GRID` and `W_QUALITY_TABLE_ROW_COUNT`. A column counts as numeric when at least two body cells parse as numbers and nothing else in it is text; blanks, dashes and `n/a` are gaps rather than text, and number parsing is positional rather than locale-aware, since `1.234` is one thousand two hundred and thirty-four in Milan and one-point-two-three-four in Chicago.

  Two decisions are worth stating because they are what keeps the rules quiet on documents that are already right. Alignment is read through each format's own cascade rather than off the cell, so a table that sets the alignment once for every cell in it is not reported as if every cell were silent. And the grid question is asked of the table's own declaration, not of the resolved borders: Word's baseline is a box around every cell and every PPTX theme draws a rule between them, so a resolved-border test would report every table that never mentioned its borders — one finding per table for a decision the theme took once, for the whole document.

  The eight reference stock templates stay warning-clean. A new `quality-fixes` suite applies every emitted patch to a private copy of its document, re-analyzes, and asserts the finding is gone and no new warning took its place — a fix that leaves its own finding standing turns a repair loop into a loop.

- 22f6f3e: Three brand and integrity rules: box overlap in PPTX, font-family count and palette adherence in both formats.

  `box-overlap` reports two opaque boxes on one slide that land on each other. Opacity carries the whole claim — an image, a chart, a table or a filled rectangle paints its entire box, so two of them intersecting really do hide each other. A _text_ box supports no such claim, and measuring against the reference decks is what settled it: every candidate finding over text was a legitimate design — an 80pt title whose generous box swallows a 12pt label beside it, a value centred in the hole of a donut chart, a corner badge inside the declared frame of a two-line heading. Text-on-text needs the ink, not the box, and belongs to the rendered pass. Transparency disqualifies a fill and only `rect`/`roundRect` count, because the decks stack tinted discs and pie wedges whose bounding boxes cross by design and whose ink never does.

  Intersecting is not the same as wrong, so the verdict is split. Two opaque boxes crossing is `info` — an accent strip along the top of a card, a badge over a photograph, both of which the reference decks do deliberately. Two cases are warnings, because neither is ever a design: a box whose geometry matches another to within two points is a leftover duplicate, and anything covering a chart or a table covers data. A box fully inside a larger one is layering and is not reported; two equal rectangles are the duplicate case and are.

  `font-count` counts the families a document can paint — the theme's `heading` and `body` plus every family named in the document — and warns past three. `mono` and `light` are excluded: they paint nothing until a component asks for them, and counting an unused `Courier New` flagged a report that uses a single typeface.

  `palette-adherence` reports a colour written as a literal that the resolved theme, overrides included, does not define, and emits an RFC 6902 fix naming the nearest token. Nearest is the "redmean" approximation, which ranks near-neighbours roughly as an eye does; ties break on token name so a document always emits the same fix. It is `info` because an off-palette colour is often deliberate — a client's brand red inside an otherwise on-theme report — and the finding exists to make the choice visible. A colour is recognised by where it sits, so a hex inside a sentence stays prose.

  Across the eight reference stock templates the three rules produce no unexplained warnings. The one that remains is true and now recorded: `standard-annual-report` really does carry four font families.

- c22a911: A document can no longer ship with its slots unfilled.

  Both formats gain `placeholder-text`, one rule answering one question — is this text real yet? — over two codes, because the two answers have different consequences. `W_QUALITY_SCAFFOLD_MARKER` is a slot still holding the `{{…}}` marker a scaffold wrote into it: `jto_validate` lists the markers and still answers `ok: true`, because a draft is a legitimate thing to hold, while `jto_generate` now refuses the document with one path-addressed `E_SCAFFOLD_MARKER` error per remaining slot. `W_QUALITY_PLACEHOLDER_TEXT` is leftover filler — lorem ipsum, "Your title here", "Click to add title", a whole-string `[bracketed placeholder]`, bare `TODO`/`XXX` — and only ever advises: nobody put it there on purpose, and nobody but the author can be sure it is not the real copy.

  The scan visits every string in the authored document rather than a list of text-bearing properties. An allowlist is the tidier thing to write and the wrong thing to ship: it drifts silently as components gain properties, and a marker it misses is a marker generation lets through. The patterns are narrow enough that a colour, a font family or a file path never matches one, and deliberate values authors do write — `TBD`, `N/A`, a citation like `[1]` — are not placeholders. Subtrees with `enabled: false` are skipped; they never reach the page. Neither code carries a fix, because only the author knows what the sentence was meant to say.

  Measured against the eight reference stock templates the finding is exact: 171 true placeholders (lorem ipsum, "Your Subtitle Text Here", "YOUR NAME HERE") and no false positives. Those are demonstration documents whose body copy is filler by design, so the calibration suite records the count per template — copying one and shipping it unedited is precisely what the rule exists to catch, which is a reason to keep it visible rather than to suppress it.

### Patch Changes

- Updated dependencies [ed3a991]
- Updated dependencies [22f6f3e]
- Updated dependencies [c22a911]
- Updated dependencies [4526e5a]
- Updated dependencies [102d8a2]
  - @json-to-office/quality@2.4.0
  - @json-to-office/shared-pptx@2.4.0

## 2.1.0

### Minor Changes

- 3c290f6: Example plugins: one `weather` component per format, calling a real API.

  `weather` now fetches from [Open-Meteo](https://open-meteo.com) instead of returning mock data — a geocoding lookup that turns a city name into coordinates, then the forecast — so the example shows what a plugin that reaches the network actually looks like: a bounded request, the two hosts it needs named in the source, and errors an author can act on (`Open-Meteo has no place called "…"`, rather than a bare `TypeError`). v1 renders the current reading (temperature, feels-like, humidity, wind, pressure, WMO conditions); v2 renders a 1–7 day forecast table with highs, lows and precipitation probability. Both honour `units: metric | imperial`. The DOCX copy now imports the plugin API by package name, the way a plugin in your own project would, so the same file compiles both on disk and in the playground's browser sandbox.

  The `columnsLayout`, `nestedSections`, `eldermoor-census` and `text-space-after` example plugins are removed; `weather` is the one worked example. This does not affect the `text-space-after` legacy custom component (`packages/core-docx/src/components/text-space-after.ts`), which is unchanged.

## 1.7.0

### Minor Changes

- dc13fa7: pptx validation gets the #292 hardening the docx side shipped. The deep walk
  (the only pptx validator — there is no whole-document stage behind it, so a
  blind spot was accepted AND rendered) now types the component-object sibling
  keys it previously only checked for presence: `enabled: "yes"`, `id: 7` and a
  non-string `$schema` — at the root, on nested components, in placeholder
  values, and a non-string `version` on plugin components — are rejected with
  path-addressed errors instead of silently rendering.

  The slide `placeholders` walk and props-strip are driven by the registry's
  `hasPlaceholders` flag instead of a hardcoded `'slide'`, so a future component
  whose published schema accepts placeholders is walked automatically. A new
  guard test mirrors the docx one: every closed object position of every
  component's props is swept with an unknown key, and every embedding position
  with prop, sibling-key and wrong-typed-sibling defects, asserting validate,
  validateStrict and generation agree on rejecting with localized errors.

### Patch Changes

- Updated dependencies [dc13fa7]
  - @json-to-office/shared-pptx@1.7.0

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
  - @json-to-office/quality@1.5.0
  - @json-to-office/shared@1.5.0
  - @json-to-office/shared-pptx@1.5.0

## 1.4.0

### Minor Changes

- 5dc65ef: The `office-open` renderer is installed rather than advertised, and every surface
  that offers a renderer now says whether it can run.

  `@office-open/docx` and `@office-open/pptx` were optional peer dependencies, so on
  any install that did not opt in — `npx` above all, where there is no project to
  `pnpm add` into — the renderer was listed by `jto_info`, listed per component by
  `jto_discover`, validated against by `jto_validate`, and then failed every render.
  The `visual` component's `renderMode: "native"` went with it, since that mode is
  documented as requiring the backend. They are ordinary dependencies now: ESM-only,
  no native code, no install scripts, 7.4 MB.

  Availability is reported as well as fixed, because an `--omit=optional` install or
  a broken tree can still produce the same gap:

  - `RendererRegistry.statuses()` loads each registered renderer once, memoized, and
    reports `{ id, default, available, reason, installHint }`. Exposed as
    `docxRendererStatuses()` / `pptxRendererStatuses()` and as `rendererStatuses()`
    on the format adapters.
  - `jto_info` returns `formats[].renderers[]` beside the existing `rendererIds`,
    and warns with the install line for any renderer that cannot load.
  - `jto_discover` marks each renderer profile `available`.
  - `jto_validate` warns when the profile a document will actually build with has no
    backend, instead of returning a clean result that the next call contradicts.

  Two error-reporting fixes alongside it:

  - `jto_preview` classified a missing backend as a generic build failure and
    suggested "a build failure is a defect in the JSON, not in the renderer" —
    sending the caller to validate a document that was never at fault. It now
    returns `E_DEPENDENCY_MISSING`, as `jto_generate` already did, and skips the
    validation pass that only added noise.
  - An internal failure no longer puts `error.stack` — absolute filesystem paths and
    module layout — into the tool result, where it reached whatever transcript the
    client keeps. Set `JTO_MCP_DEBUG_STACKS=1` to restore it.

- f6476d3: A named PPTX text style now carries a place on the slide, and a table looks like a
  table before anyone styles one.

  **Named styles land in a band.** `title`, `subtitle`, `heading1`–`3`, `body` and
  `caption` described type and nothing else, while every text box that stated no
  `x`/`y` resolved to (0, 0). A slide with a `title` and a `subtitle` therefore drew
  both blocks on top of each other in the top-left corner — the exact shape of the
  shipped `pptx-deck` starter. Each style now has a default band expressed as
  fractions of the slide extent, so it holds at any aspect ratio. Each axis is
  decided on its own, so a stated `x` still wins for `x`, and a text box with no
  `style` keeps the origin it has always had.

  Two positionless boxes can still share a band — two of the same style — so that
  case is reported as `TEXT_OVERLAP_UNPOSITIONED` rather than silently drawn.
  Moving one of them is a layout engine's job and belongs with the coordinate-free
  layout work, not with a default.

  **Tables get a border and a header row.** No bundled theme defined
  `componentDefaults.table`, so a table rendered as bare text in columns: no rule
  between cells, nothing marking the first row. The themes now state a border, and
  `headerRow` — a new optional prop on the PPTX table — defaults on through them. It
  is a compile-time treatment of row 0, so nothing new reaches either renderer, and
  every part of it yields to something the author said: a cell's own `fill`, `bold`
  or `color`, or a table-wide `fill`, `color` or `fontWeight`. A stated
  `fontWeight` aliases the family to a real sub-family rather than setting `bold`,
  so the header leaves the weight alone there — otherwise an explicit `400` would
  be overruled, and a Light table would get a header synthesised bolder than the
  body under it.

  No `margin` default: cell insets are a capability the `office-open` renderer
  refuses, and a theme default every table inherited would have turned a working
  backend into one that fails every table.

  The two table components are also described honestly for the first time. The DOCX
  table is column-major (`columns[]`, each with its own `header` and `cells[]`); the
  PPTX table is row-major (`rows[][]`, no structural header). Both descriptions now
  say which they are and name the other, so an agent that has just written one does
  not get the other wrong on the first try.

### Patch Changes

- Updated dependencies [5dc65ef]
- Updated dependencies [f6476d3]
  - @json-to-office/shared@1.4.0

## 1.3.0

### Minor Changes

- 2bfa7ae: Chart styling is now a capability a pptx renderer either has or refuses.

  `charts` said a backend could draw a chart from data. It said nothing about
  whether that backend honoured the options the chart was _styled_ with, and the
  office-open renderer read almost none of them: it accepted a chart, drew it, and
  quietly dropped the data labels, the axis bounds, the grid lines, the fonts and
  the bar, line, pie and radar tuning. An ignored `valAxisMaxVal` draws a
  different chart from the authored one and nothing in the file says so.

  Ten finer capabilities now sit beside `charts` — `chart-data-labels`,
  `chart-data-border`, `chart-axis-scale`, `chart-axis-visibility`,
  `chart-axis-style`, `chart-bar-style`, `chart-line-style`, `chart-pie-style`,
  `chart-radar-style` and `chart-text-style`. The compiler requires one **only
  when the matching prop was authored**, at that prop's own path, so a refusal
  names the line to change rather than the chart.

  Keyed off the authored props rather than the compiled IR deliberately:
  `compileChartLabelFont` falls back to the theme body font when a weight is
  authored without a face, so a compiled font object can hold a family the author
  never wrote — asking the IR "was a font set here?" would demand
  `chart-text-style` of a chart that only styled its weight.

  Three are implemented so far — `chart-bar-style`, `chart-pie-style` and
  `chart-data-labels` — by forwarding `gapWidth`, `overlap`, `holeSize`,
  `firstSliceAngle` and per-series `dataLabels` to the backend.

  Data labels write every flag explicitly, and that is not tidiness. A DrawingML
  `CT_Boolean` has an optional `val` that defaults to **true**, so
  `<c:dLbls><c:showVal/></c:dLbls>` does not mean "show the value" — it means show
  the value, the category name, the series name, the percentage and the legend
  key, because every flag left out defaults to on. A chart authored with
  `showValue: true` came out labelled `Q1; Revenue; 120`.

  The three axis capabilities — `chart-axis-scale`, `chart-axis-visibility` and
  `chart-axis-style` — follow, and these are the ones that could misrepresent
  data: an ignored `valAxisMaxVal` rescales a chart without saying so.

  They are spliced rather than passed, because `AxisOptions` cannot be handed to
  `@office-open` at all. The axis is rebuilt rather than patched: CT_CatAx and
  CT_ValAx fix the order of their children — `majorGridlines` before `title`
  before `numFmt` before `spPr` before `txPr`, all between `axPos` and `crossAx` —
  and inserting each edit at its own anchor put whichever landed last in front of
  the others, which a reader offers to repair rather than draws wrong.

  Then `chart-line-style`, `chart-data-border` and `chart-radar-style`. The
  series marker and `smooth` pass through; the other three have nowhere in the
  backend to go. `ChartSeriesCommon` carries no line width, so `lineSize` is
  spliced into `c:ser/c:spPr/a:ln`; `dataBorder` becomes an outline in the same
  place — or on each `c:dPt` of a pie, which is coloured per slice — without
  displacing the fill. `c:radarStyle` is written from a literal `standard`, so
  `marker` and `filled` had nowhere to go and became `standard` without a word.

  `lineSize` and `dataBorder` reach the same `a:ln` and never at the same time:
  one is the width of a series that _is_ a line, the other an outline on a series
  that is a filled shape. Checked against pptxgenjs rather than assumed — given
  both, it writes the border on a bar chart and `lineSize` on a line chart.

  Last, `chart-text-style`: `a:defRPr` spliced into the chart title's runs, the
  legend's existing `c:txPr`, every series' `c:dLbls`, and each axis. An axis
  rotation and an axis font land in _one_ `c:txPr` — they are two properties of
  the same text, and a second one is a repair prompt rather than a
  differently-styled label.

  With that the gap is closed: office-open declares all ten, and nothing a chart
  can be styled with is accepted-and-dropped any more.

  `c:overlap` goes with a stacked grouping — stacked bars that do not overlap are
  drawn side by side and look clustered — but the two cannot be written together.
  CT_BarChart orders `barDir`, `grouping`, `varyColors`, `ser`, `dLbls`,
  `gapWidth`, `overlap`, `serLines`, `axId`, so an overlap written beside the
  grouping lands before `c:ser`; `c:grouping` is also a child of `c:lineChart` and
  `c:areaChart`, neither of which allows an overlap; and an author who set
  `barOverlapPct` already has one. It now goes in at its own anchor, inside
  `c:barChart` only, and never twice.

  `pptxgenjs` declares all ten; it already forwards every one of those props, so
  no deck that renders today stops rendering. `office-open` now declares all ten too. The capability split remains the
  contract: a prop is honoured or refused by name, never accepted and dropped.

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

### Patch Changes

- Updated dependencies [efd9982]
  - @json-to-office/shared@1.3.0
  - @json-to-office/shared-pptx@1.3.0

## 1.2.0

### Minor Changes

- ad35065: Generate presentations whose slides omit `props`. Validation has always accepted a slide with no `props` — every slide prop is optional, so the deep validator checks an empty object — but generation dereferenced `props.placeholders` unguarded and died on those documents with `TypeError: Cannot read properties of undefined`. `SlideComponentDefinition['props']` is now optional too, matching what validation accepts.

### Patch Changes

- Updated dependencies [ad35065]
  - @json-to-office/shared-pptx@1.2.0
  - @json-to-office/shared@1.2.0

## 1.0.0

### Major Changes

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
  - @json-to-office/shared-pptx@1.0.0

## 0.36.0

### Minor Changes

- c89a2d8: Ship a real raster fallback for inline `svg` images instead of a broken-image
  placeholder, and expose a `warnings` sink on `PresentationPackagingOptions`.

  An SVG picture travels as two media parts: the SVG itself, referenced by
  `<asvg:svgBlip>` inside the blip's `<a:extLst>`, plus a PNG preview referenced
  by the `<a:blip r:embed>` that every consumer understands. PptxGenJS builds
  that preview with a browser canvas, so under Node it writes its hardcoded
  broken-image placeholder instead (gitbrent/PptxGenJS#401) — and every viewer
  without svgBlip support drew a red X where the artwork belonged. PowerPoint
  2016+ reads the vector and was never affected, which is why the shipped
  templates looked fine locally and broke in the LibreOffice-backed preview.

  `packagePresentationBuffer` now pairs each svgBlip with its preview part
  through the slide/layout/master rels and overwrites the placeholder with a
  resvg rasterization sized for the box the picture is placed in (~288 DPI,
  capped at 4096px, cached by content). The pass is best-effort: a missing
  native binding or an SVG resvg rejects leaves the package exactly as generated
  and reports `IMAGE_SVG_RASTER_FAILED`, so a broken preview can never fail a
  build — but it is no longer silent, which was half the defect.

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
  - @json-to-office/shared-pptx@0.35.0

## 0.33.0

### Patch Changes

- Updated dependencies [2ae9268]
  - @json-to-office/shared@0.33.0
  - @json-to-office/shared-pptx@0.33.0

## 0.32.0

### Patch Changes

- Updated dependencies [0b021e5]
  - @json-to-office/shared-pptx@0.32.0

## 0.29.0

### Patch Changes

- Updated dependencies [b536bb6]
  - @json-to-office/shared@0.29.0
  - @json-to-office/shared-pptx@0.29.0

## 0.28.0

### Minor Changes

- a033a8b: Relative image/media paths now resolve against the document's own directory instead of `process.cwd()` (#142). New `baseDir` option on core generation (`generateBufferFromJson` et al.), plugin builders (constructor + per-call), CLI `generate` (auto-set to the input file's directory), the playground server (via `options.sourceName` mapped through discovery), and the pptx rasterizer request (docx `visual` components forward it). cwd stays the fallback when no baseDir is provided. Stock template media paths shrunk to document-relative `media/...`; stale `templates` entry dropped from `packages/jto` package `files`.

### Patch Changes

- Updated dependencies [a033a8b]
  - @json-to-office/shared@0.28.0
  - @json-to-office/shared-pptx@0.28.0

## 0.27.0

### Minor Changes

- 43defd5: Plugin builders: a document explicitly naming a known built-in theme now gets that built-in, instead of being shadowed by the constructor `theme` object. The constructor object still applies when the document names no theme or names something nothing recognizes (unknown-name fallback preserved). customThemes entries keep top precedence. Same contract in DOCX and PPTX.

## 0.26.0

### Minor Changes

- 6aa719e: Hand the resolved theme to `processPresentation` by value.

  `processPresentation` used to re-resolve the theme a third time, by name,
  from `props.theme` — which forced both generation prologues to rewrite
  `props.theme` to a scoped synthetic name and inject the resolved theme
  into `customThemes` under it, and to flatten inline theme objects into
  generated named entries. `GenerationOptions.theme` now carries the
  resolved theme directly; the rewrite/injection dance is deleted and a
  document with an inline theme round-trips with `props.theme` exactly as
  authored. The name/inline lookup remains as the fallback for direct
  `processPresentation` callers.

  Render-neutral: all 3 stock templates (inline themes) byte-identical via
  both entry points.

### Patch Changes

- df039c1: Unify the PPTX generation prologue behind a shared generation context.

  Both entry points — `generateBufferFromJson` and
  `createPresentationGenerator` — now resolve themes, run the export-mode
  pre-pass and derive the cache key through `core/generationContext.ts`,
  mirroring the DOCX module, so the next root-level prop cannot reach one
  pipeline and not the other.

  Three divergences closed along the way, all behind
  `validation: { enabled: false }` or a constructor default:

  - A document without root `props` now renders with the default theme on
    both paths instead of dying with a raw TypeError; `props: null` gets a
    clear error message.
  - Conflicting payloads (image `path`+`base64`, text `text`+`runs`) are now
    rejected on the plugin path too, checked on the expanded tree so custom
    components can't emit conflicts either. Previously only the core path
    threw; the plugin path silently resolved by runtime precedence.
  - A constructor-supplied string theme naming a `customThemes` entry was
    silently dropped between font resolution and slide processing when the
    document named no theme — slides rendered with the default theme. It now
    applies.

  Render-neutral: all 3 stock templates byte-identical via both entry points.

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

- f3b3674: Fix three props that validated and rendered while being silently ignored.

  `font.characterSpacing` reached paragraphs but not headings, and was dropped
  whenever the text contained a placeholder — so the same value rendered letter
  tracking for plain text and lost it for `Generated on {DATE}`. Both paths
  already forwarded `font.scale`.

  An unknown `shape.fill.pattern.preset` warned that it was falling back to the
  solid foreground and then set no fill at all, leaving the shape on the
  pptxgenjs default. It now uses the pattern foreground, with an explicit
  `fill.color` still taking precedence.

  `props: null` surfaced as `Cannot read properties of null` from theme
  resolution on the one entry point that runs no validator (`generateDocument`
  with no `$schema`); it now throws a clear error naming the problem.

- Updated dependencies [96c30b3]
  - @json-to-office/shared-pptx@0.25.0
  - @json-to-office/shared@0.25.0

## 0.24.0

### Patch Changes

- Updated dependencies [5e6f5df]
  - @json-to-office/shared-pptx@0.24.0

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

- e311268: fix(pptx): slide-targeted hyperlinks are authored-position based and never dangle

  `hyperlink.slide` was written straight through to pptxgenjs, which turns it into a relationship to `ppt/slides/slideN.xml`. Nothing checked that the part existed, so an out-of-range number produced a relationship to a slide that is not in the archive — an ECMA-376 violation PowerPoint reports as a damaged file, with no warning from the generator. `enabled: false` made that reachable without anyone touching a slide number: dropping a mid-deck slide shortened the deck and shifted every slide after it.

  `hyperlink.slide` now means **the Nth slide as authored in the JSON, counting slides switched off with `enabled: false`**, and is rebased onto the generated numbering at build time. Toggling a slide off no longer retargets the links that point past it — a link to authored slide 5 still lands on the content the author called slide 5, wherever it ends up. A ref that resolves to nothing (its target was switched off, or the number is outside the authored range) is dropped, and the component renders without a link plus a `HYPERLINK_SLIDE_UNRESOLVED` warning; it is never written as a dangling relationship. Decks with no disabled slides map one-to-one and are unchanged.

- e311268: fix(pptx): `enabled: false` on a slide actually drops the slide

  Every PPTX component honours `enabled: false` — except the `slide` container itself. `processPresentation` walked the presentation's children and rendered each slide unconditionally, so a slide switched off in the JSON still appeared in the deck, at full size, in its original position. The check now runs on the slide node, matching both the component-level behaviour in this package and the way DOCX has always treated the flag.

  **Decks that carry `enabled: false` slides get shorter.** A deck relying on the bug — a slide switched off but still expected in the output — will lose that slide and the ones after it will shift up. Remove the flag from any slide you want rendered. Slides with no `enabled` key are unaffected.

### Patch Changes

- Updated dependencies [e311268]
  - @json-to-office/shared@0.22.0
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
  - @json-to-office/shared-pptx@0.21.0
  - @json-to-office/shared@0.21.0

## 0.20.0

### Minor Changes

- bc15ebf: feat(docx,pptx): highcharts charts follow the document theme by default

  The `highcharts` component forwarded its config verbatim, so charts with no explicit `colors` rendered in the Highcharts default palette (blue-first) regardless of theme. When `options.colors` is absent, the renderer now injects the theme palette — pptx uses the same token list as the native `chart` component (primary, secondary, accent, accent4-6); docx uses primary/secondary/accent. Explicit `colors` always wins, so existing configs that set colors are unchanged.

- de4d21c: feat(pptx): `props.theme` accepts an inline theme config object

  A presentation can now embed its theme directly (`props.theme: { name, colors, fonts, defaults, ... }`) instead of naming a built-in or `--theme-path` theme, keeping the document fully self-contained. Both generators normalize the inline object to a named customThemes entry, so font-mode scoping and name-keyed theme re-resolution work unchanged. Validation checks the inline object against `ThemeConfigSchema`.

### Patch Changes

- Updated dependencies [bc15ebf]
- Updated dependencies [de4d21c]
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
