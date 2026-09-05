# @json-to-office/core-docx

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

- 102d8a2: Three theme-loading defects, all of the same kind: a theme that validates, renders, and quietly is not what the file said.

  **DOCX theme layers were deleted between validation and the renderer.** `ensureThemeDefaults` rebuilt the theme from a hand-written literal of the ten root keys it knew about, so everything else the schema allows was dropped — `fontRegistry` and `noProofWords` on every bundled theme and every `--theme-path` render. Nothing failed: the file validated, generation succeeded, and the styling was simply absent, with no error to search for. It now spreads what it was given and backfills defaults after, at the root and inside `fonts`. `theme-round-trip.test.ts` walks `ThemeConfigSchema` and fails the day a property is added and forgotten here, which is the only moment that is cheap to fix. No shipped theme declares either key, so nothing renders differently today — this stops the next layer from vanishing the same way.

  **The PPTX theme guard checked nothing.** `isValidThemeConfig` was `typeof data === 'object' && data !== null`: `{}` came back `true`, and the caller carried on with a `ThemeConfigJson` the compiler trusted and could not read. It is now `Value.Check` against the schema, the same contract the DOCX twin has always had.

  **A PPTX `--theme-path` file was parsed but never validated.** The DOCX branch calls `loadThemeFromFile`; the PPTX branch did bare `readFileSync` + `JSON.parse` and handed the result to a compiler that reads `theme.defaults.fontSize` unguarded — so a malformed theme surfaced as a TypeError in the IR instead of a diagnostic naming the field. It now goes through `validatePptxTheme` and refuses with the first three errors, keeping the document's own theme.

- Updated dependencies [ed3a991]
- Updated dependencies [22f6f3e]
- Updated dependencies [c22a911]
- Updated dependencies [4526e5a]
  - @json-to-office/quality@2.4.0

## 2.3.0

### Minor Changes

- b73f62f: `/validate` knows the plugin components the rest of the server knows.

  The dev server's `POST /api/<format>/validate` validated against the standard components alone, so a document naming a registered plugin came back `Unknown component "weather"` — the same name the schema route had just offered for completion and the generator would have expanded happily. The route now hands the registered components to the plugin-aware validator, which defers those nodes from the standard walk and checks each one's props against the version it resolves to. With no plugins registered nothing changes: `weather` is still unknown, which is the honest answer from a server that cannot build it either.

  Doing that exposed a second defect, in `core-docx`'s plugin validator itself: its walk returned at the first node that was not a custom component instead of descending, so it only ever checked components at the top level. A plugin component inside a `section` — every real document — was never validated against its props schema, by this route or by the pre-generation gate; `city: 123` passed both and failed later inside the component's own render. It now descends whatever the node is, matching what `core-pptx` already did. Custom components carried in props rather than `children` (a header, a table cell) are still outside this pass.

  `FormatAdapter` gains an optional `validateDocumentWithPlugins(doc, plugins)`, async because the core that owns the plugin-aware validators is imported on demand. Callers with an empty registry keep using the sync `validateDocument`.

## 2.1.0

### Minor Changes

- 3c290f6: Example plugins: one `weather` component per format, calling a real API.

  `weather` now fetches from [Open-Meteo](https://open-meteo.com) instead of returning mock data — a geocoding lookup that turns a city name into coordinates, then the forecast — so the example shows what a plugin that reaches the network actually looks like: a bounded request, the two hosts it needs named in the source, and errors an author can act on (`Open-Meteo has no place called "…"`, rather than a bare `TypeError`). v1 renders the current reading (temperature, feels-like, humidity, wind, pressure, WMO conditions); v2 renders a 1–7 day forecast table with highs, lows and precipitation probability. Both honour `units: metric | imperial`. The DOCX copy now imports the plugin API by package name, the way a plugin in your own project would, so the same file compiles both on disk and in the playground's browser sandbox.

  The `columnsLayout`, `nestedSections`, `eldermoor-census` and `text-space-after` example plugins are removed; `weather` is the one worked example. This does not affect the `text-space-after` legacy custom component (`packages/core-docx/src/components/text-space-after.ts`), which is unchanged.

## 2.0.0

### Major Changes

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

### Patch Changes

- Updated dependencies [2d1a10b]
  - @json-to-office/shared-docx@2.0.0

## 1.11.0

### Minor Changes

- 64b7905: Escape the inline mini-language with a backslash.

  `\*`, `\_`, `\[`, `\]`, `\{`, `\}` and `\\` now render as themselves. Without
  that, a code sample was unwritable: `grant_type=client_credentials` has two
  underscores, so the parser read the span between them as emphasis and the
  reader got _granttype=clientcredentials_ — visible in the shipped
  `technical-guide` for as long as it had code in it.

  A backslash before anything else is still a backslash, so `C:\temp` and `50\%`
  are untouched, and `parseLiteral` does not unescape: the paths that promise
  character-for-character output still give one.

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

- c6f97a0: Rebuild the two shipped DOCX templates, and split them across two themes.

  `proposal` and `technical-guide` were re-authored from scratch with the
  `vermilion-annual-report` stock template as the reference — its display-heading
  scale, its hairline tables with a single accent rule and a flush-left first
  column, its muted body colour and tinted emphasis rows, its KPI figures, and a
  full-bleed cover and back cover. Both gained a running header and footer, a
  designed contents page, and diagrams sized to render at readable type.

  The two then split by house style, because a pair of examples that look alike
  demonstrates half as much. `proposal` keeps `vermilion`; `technical-guide` moved
  to the bundled `devportal` theme — cool slate, one teal accent, monospace where
  the reader is expected to type — which until now no shipped document used. The
  composition rules carried over unchanged; the dressing did not: a monospaced
  section index, headings set solid over the theme's own accent rule, table
  headers as a shaded band rather than a vertical rule, and code in a closed
  fence. `devportal`'s margins give a 487.3pt measure against `vermilion`'s
  477.3pt, so every fixed column width and page break was re-checked.

  One structural change is worth copying: a numbered part of a document is no
  longer its own Word `section`. A section exists to change page setup or chrome,
  these parts change neither, and a section ends with the empty paragraph that
  carries its break — which produced a blank page whenever a part happened to fill
  its last page. Both documents now use three sections (cover, body, back cover)
  and put `pageBreak` on each part's opening paragraph instead.

### Patch Changes

- 5757874: Two fixes to the inline escape pass, both found by review on #305.

  An authored private-use character survives parsing. Each escape was swapped for
  a bare character in U+E000–U+E006, and decoding mapped that whole range back
  unconditionally — so text that already contained one of those codepoints came
  back as a metacharacter, with no backslash anywhere in the input. An icon font
  puts its glyphs in the private use area, which is how a document runs into
  this. Substitutions are now a sentinel plus a marker, and the author's own
  sentinels are guarded before the pass, so encoding is reversible.

  An escape inside a link destination decodes. `parseInline` encodes before
  `parseLinks` runs, and the captured target went into `target.url` untouched, so
  `[x](https://host/a\_b)` put a private-use character in the URL that reached the
  relationship. Destinations and cross-reference ids are now decoded at the link
  boundary — the one place a target stops being parsed text.

- dd0240c: A `{PAGE}` or `{TOTAL_PAGES}` field now keeps its formatting in LibreOffice, and
  therefore in the PDF path and `jto_preview`. docx.js packs `begin`, `instrText`,
  `separate` and `end` into a single `w:r`; Word reads that, LibreOffice does not
  — it computes the number itself and paints it with the document default, so the
  `Page {PAGE}` running header both shipped templates use rendered "Page" at 8pt
  grey and the numeral at 11pt black. The `docxjs` adapter now writes one run per
  field character, each repeating the same `rPr`, which is also the shape Word
  itself writes.

  Measured rather than reasoned: six XML shapes were rendered through
  `soffice --convert-to pdf` and the glyphs' font, size and colour read back out.
  Splitting the runs fixes it with or without a cached result; a cached result
  inside the single run does **not**, nor does a `w:fldSimple` carrying a fully
  formatted cached run — LibreOffice recomputes and discards that run's
  properties. `<w:pgNum/>`, which would inherit `rPr` for free, renders as
  nothing at all.

  No cached result is written between `separate` and `end`. Nothing in this
  pipeline paginates, so the only value available would be a fabricated one —
  right on page 1 and wrong on every page after it in any reader that shows the
  cached result instead of recomputing. That is the opposite call from the TOC
  field, which does ship cached entries: there the cached text is the real
  heading text, known at generation time. A page number is not.

  Every corpus golden containing a page field moved, and only those — 11 cases,
  including both shipped templates. A field still loses its formatting on the
  experimental `office-open` backend, which writes every field as a bare
  `<w:fldSimple/>` with no run properties at all; that gap is recorded in
  `docs/architecture/office-renderer-ir.md` rather than fixed.

## 1.10.0

### Minor Changes

- d76f59c: Rename the `rule` component to `divider`.

  `rule` was the typographic term and the word #291 used, but this codebase
  already spends it: `QualityRule`, rule packs, rule ids, `docx/line-box`, and
  OOXML's own `lineRule` sits in the very property the component sets. Prose
  about the component and prose about the lint were a paragraph apart and read
  the same. `divider` is what component libraries settle on for the same reason.

  Nothing but the authored name changes — same props, same paragraph border, same
  collapsed line box, byte-identical output, and the corpus goldens did not move.
  `W_QUALITY_LINE_BOX_COLLAPSE` now points at `"divider"`.

  **Breaking for anyone who wrote `{ "name": "rule" }` against 1.9.0**, which
  shipped the component under its old name. There is no alias: keeping one would
  enshrine the ambiguity the rename exists to remove, and the name was published
  for a matter of minutes. Rename the node; nothing else moves.

### Patch Changes

- Updated dependencies [d76f59c]
  - @json-to-office/shared-docx@1.10.0

## 1.9.0

### Minor Changes

- aaab6ee: New `docx/line-box` rule (`W_QUALITY_LINE_BOX_COLLAPSE`): an `exactly` line box
  shorter than the capitals of the text it holds. `font.size` is floored at 8pt
  because smaller type cannot be read, but the box the glyphs sit in had no guard
  at all, so `{ "type": "exactly", "value": 1 }` on 8pt type validated clean and
  rendered as a smear of overlapping lines (#291).

  The guard is relative rather than a schema floor, because an absolute floor
  would be wrong: an empty spacer paragraph legitimately pins 2pt, and the stock
  templates draw thin gaps that way. It fires only on `exactly` — `atLeast` and
  the multiples can never be shorter than the text needs — only where there is
  text to clip, and only below 0.7 em, which is cap height on the faces the stock
  templates use and below every legitimate value in the reference corpus (whose
  tightest exact box is 10pt on 12pt type). The repair grows the box to one em,
  not to the floor: rendered at 8pt, stacked lines still touch at the floor and
  are clean at one em. Sizes resolve through `componentDefaults` and the
  paragraph style — its own size, else the theme font it names — so a collapsed
  box is caught whether or not the component states its own size.

  `lineSpacing.type` and `lineSpacing.value` also gained the descriptions they
  never had — which unit each rule reads, and why `value` has no floor.

- 6bfe784: New `rule` component: a horizontal rule, the thin line a brand system draws
  between sections. Follow-up to #291, whose closing note this implements — the
  route that issue caught (an 8pt paragraph with a 1pt exact line box, wanted as
  a 3pt rule) existed because nothing else drew a line: `font.size` floors at
  8pt, `paragraph` has no border, and the alternatives were a `visual`, a
  bordered `text-box` or a one-row table.

  ```json
  {
    "name": "rule",
    "props": { "thickness": 3, "color": "accent", "width": "40%" }
  }
  ```

  `thickness` (points, 0.25–12), `color` (hex or theme token, default the theme's
  `border`), `style` (solid/dashed/dotted/double), `width` (points or `"NN%"`,
  default the full measure), `alignment`, `spacing` (default 6pt either side).

  It compiles to what Word itself draws: an empty paragraph wearing a `w:pBdr`
  bottom border, so the result stays a real Word object rather than a picture of
  a line. The paragraph's own line box is collapsed to 1pt — the same
  construction #291 reports when it is hand-rolled on a paragraph carrying text,
  correct here because there are no glyphs to clip, and done once in the compiler
  so nobody has to reach for it. A partial `width` becomes paragraph indents,
  resolved against the theme page like `image`'s percentage widths; the default
  full-measure rule states no indent at all and is therefore exact wherever it
  lands.

  `W_QUALITY_LINE_BOX_COLLAPSE` now names the component in its suggestion, which
  is the point: that finding is usually someone drawing a line, not setting
  leading.

  Both renderers emit it, from the same IR, byte-identically — `borders` leaves
  the list of features the compiler could only declare and joins the capability
  set both adapters prove with a test. `docxjs` gained paragraph-border emission
  to get there; it had the IR field and dropped it. The empty-paragraph spacer
  idiom is untouched: that draws a gap, not a rule.

### Patch Changes

- Updated dependencies [aaab6ee]
- Updated dependencies [6bfe784]
  - @json-to-office/shared-docx@1.9.0
  - @json-to-office/quality@1.9.0

## 1.7.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [4b596aa]
  - @json-to-office/shared-docx@1.7.0

## 1.6.0

### Minor Changes

- 40ceaa4: Table border sides you name now always render, identically everywhere. A side
  named in a per-side `borderColor`/`borderSize` object on a cell or its column
  survives `hideBorders` (which now only silences inherited table-level borders)
  and owns its shared edge: the compiler adjudicates every interior edge — a
  named side beats an inherited one, equals fall to ECMA-376 §17.4.66's weight
  rules — and writes the winner on both cells, so Word and LibreOffice stop
  resolving the same file differently. Previously a cell's red divider could
  render in Word but vanish from the LibreOffice-rendered PDF preview, and
  templates had to state both halves of every internal edge to compensate.
  Scalar `borderColor`/`borderSize` on a cell remain restyling knobs that claim
  no side.

  Also fixes `mergeWithDefaults` destroying an object-form table-level
  `borderColor`/`borderSize` when the theme's `componentDefaults.table` states a
  scalar for the same key — the string was spread into `{0:'#',1:'f',…}` and the
  author's per-side object silently vanished.

- 40ceaa4: New `docx/frame-collision` rule (`W_QUALITY_FRAME_COLLISION`): page-anchored
  floating frames whose estimated text blocks land on the same page region are
  reported as painting over each other — the text-on-text defect the text-fit
  rule could not see, since it never compared two frames.

  Frame rects come from authored offsets/width plus estimated wrapped height.
  Consecutive paragraphs with identical frame properties collapse into one
  flowing OOXML frame first (the stock stat-card idiom), overlaps inside one
  line height are noise by construction, and slivers of shared width under
  240 twips are ignored. Calibrated warning-clean on the stock reference
  templates and the all-floating vermilion annual report; frame-text facts gain
  resolved anchors, frame-chain identity, and page-flow grouping to carry it.

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
  - @json-to-office/quality@1.5.0
  - @json-to-office/shared@1.5.0
  - @json-to-office/shared-docx@1.5.0

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

- 47bd0af: The DOCX `statistic` renders the props it has always accepted, and defines the
  styles it has always named.

  `unit`, `size`, `trend` and `trendValue` were declared, accepted by the schema,
  reported clean by validation and generation, and read by nothing:
  `{ "number": "99", "unit": "%" }` produced `99`. The shipped `docx-report` starter
  used `unit: "%"`, so an agent copying it — which is what starters are for — lost
  the percent sign with no diagnostic anywhere in the pipeline.

  - `unit` renders as a suffix run at half the figure's size, with no separator, so
    `"99"` + `"%"` reads as one value. Write the space into the prop if you want one.
  - `size` sets the figure to 20/28/40pt for small/medium/large. `medium` states
    nothing on the run and takes it from the style.
  - `trend` renders `▲`/`▼`/`–` — a glyph, not a colour, because the palette has no
    semantic success/danger slot and down is not bad for churn — with `trendValue`
    beside it in the muted text colour.
  - `format` remains unimplemented; "number format pattern" names no dialect. It now
    warns (`W_STATISTIC_FORMAT_IGNORED`) instead of vanishing.

  The two paragraphs also carried `StatisticNumber` and `StatisticDescription`,
  style ids that nothing in the codebase defined. An undefined `w:pStyle` is not an
  error in OOXML — it resolves to Normal — so the component built for KPIs rendered
  at body size and weight, and a heading plus a paragraph gave a better result than
  the purpose-built component. Both styles are now generated from the theme: the
  figure at 28pt in the heading font on the primary colour, `keepNext` so it never
  splits from its caption; the caption at 10pt in the muted text colour. A theme
  that names either id under `styles` still wins.

  Only documents that contain a statistic get the styles, so no other output moved.

### Patch Changes

- 47bd0af: Fix two DOCX layout defects that only show up in a rendered page.

  **A list marker sat outside the page margin.** Every bundled theme set
  `componentDefaults.list.indent: 3`. That field is points, so level 0 compiled to
  `w:ind w:left="60" w:hanging="360"` — a marker 300 twips to the _left_ of the text
  margin, outdented past the body text it labels. The themes no longer state it, so
  the per-level default applies: 720/360, which is Word's own. `IndentSchema` now
  documents its unit, since the neighbouring `ParagraphIndentSchema` is twips and
  neither said so — which is how the value came to be written in the first place.

  **Whatever followed a table drew on its bottom border.** OOXML gives a table no
  space-after; the property does not exist. A heading was fine because its style
  carries space above, but a body paragraph and a list item both landed on the rule.
  A body block directly under a table now gets 120 twips above it. Styles that
  already contribute their own space are left alone — topping up a `Heading2` would
  make it less separated, not more — and so is an author who stated a value.

  For that last part to hold, list spacing had to start treating zero as a value.
  `itemSpacing` tested `before`, `after` and `item` for truthiness, so
  `spacing: { before: 0 }` produced no `beforeTwips` at all and was
  indistinguishable from silence — the new rule would have handed such a list the
  120 twips it explicitly asked not to have. All three are read against `undefined`
  now, which also makes `spacing: { after: 0 }` mean what it says instead of
  falling through to `item`; the corpus case named `component-defaults-instance-wins`
  had that exact shape and the instance was not winning.

- Updated dependencies [47bd0af]
- Updated dependencies [5dc65ef]
- Updated dependencies [f6476d3]
- Updated dependencies [47bd0af]
  - @json-to-office/shared-docx@1.4.0
  - @json-to-office/shared@1.4.0

## 1.3.0

### Minor Changes

- 06f2f1b: Add a native `chart` component for DOCX, drawn by the `office-open` renderer.

  A real Word chart part with its own embedded workbook: recipients can restyle it
  with Word's chart tools and open its numbers with **Edit Data**, it stays crisp
  at any zoom, and it needs no export server — so unlike `highcharts` it also
  works in the browser. Props mirror the pptx `chart` component (`type`, `data`,
  `title`, `showLegend`, `chartColors`) with the flow placement `image` and
  `highcharts` already use; slide coordinates are rejected rather than ignored.

  `bubble` is not among the types: `@office-open` spells a bubble series as
  x/y/size triples rather than categories and values, and handing it the latter
  throws from inside its own bundle. It is refused by the schema and again at
  compile time.

  `docxjs` has no chart primitive at all, so it declines the new `charts`
  capability and a document using the component fails with a named capability
  error instead of losing the figure. The component is absent from that renderer's
  schema branch entirely, so editors never offer it there.

  `@office-open/docx` forwards only eight `ChartSpaceOptions` fields from a chart
  run, which leaves the chart with no `c:externalData`, no series colours and no
  axis titles — "Edit Data" fails and every series ignores the theme. Those parts
  are spliced into the package after generation, and the workbook is built here
  because nothing in `@office-open/core` writes one.

### Patch Changes

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

- Updated dependencies [06f2f1b]
- Updated dependencies [efd9982]
  - @json-to-office/shared-docx@1.3.0
  - @json-to-office/shared@1.3.0

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

- 9520fa3: Fix a shape-mode `text-box` losing its padding and border colour on `office-open`

  A `text-box` with `renderAs: "shape"` built two option keys the backend does
  not read, so both values were accepted and then dropped on the way out.

  `style.padding` was emitted as `topInset`/`bottomInset`/`leftInset`/`rightInset`.
  `a:bodyPr` takes `lIns`/`tIns`/`rIns`/`bIns` (or a `margins` object), and no
  `*Inset` key exists anywhere in `@office-open/docx` — so every shape text box
  drew with the format's default insets and its text sat against the border.

  `style.border`'s colour was nested under `outline.fill`. `OutlineOptions` is
  line properties and fill properties merged into one bag, and it carries the
  colour at the top level; a nested `fill` is ignored, so the border drew in the
  default colour rather than the authored one.

  Both are corrected against the same helpers the drawing-group emitters use.
  `docxjs` always had them right, so this only moves `office-open` output — and
  only towards it: the two backends now emit the same insets and the same
  `<a:ln>` for the same document.

- Updated dependencies [9dbf86b]
- Updated dependencies [fdf9c51]
  - @json-to-office/shared-docx@1.1.0
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

- cea7b6b: DOCX generation is now deterministic for documents containing hyperlinks

  docx.js numbers most relationships `rId1`, `rId2`, … but mints ids for external
  hyperlinks from `Math.random`. Packaging normalised timestamps and ZIP headers
  but not those ids, so **any document containing a link produced different bytes
  on every render** — which defeated the point of `deterministic` generation and
  made a linked document impossible to pin with a content hash.

  Packaging now canonicalises volatile relationship ids to the conventional
  `rIdN` form, numbering them by first appearance in the part that references
  them. Documents with no volatile ids are byte-identical to before.

  This is generic package finalisation — a property of an OOXML package rather
  than of any one backend — so it applies regardless of which renderer produced
  the file.

- 7319f5f: A hyperlink inside a table cell no longer damages the document

  A markdown link in a table cell emitted an `r:id` that `word/_rels/document.xml.rels`
  never declared — a dangling relationship, which **Word reports as a damaged file**.
  Only the first document generated in a process was correct; every one after it was
  broken, so a long-running server produced them almost exclusively. The same link in
  an ordinary paragraph was always fine.

  Tables go through the cross-document component cache and paragraphs do not, which is
  the whole difference. docx.js registers an external hyperlink by mutating the rendered
  tree at pack time: it swaps each `ExternalHyperlink` for a concrete one carrying a
  freshly minted id and declares that id on the document being packed. A cached table
  handed to the next document arrived already concrete, so nothing was registered and
  the id it emitted belonged to a document that had been written and closed.

  Components carrying an external link now skip that cache, the way revision- and
  comment-bearing components already do. Internal `#anchor` links reference a bookmark
  directly, cost no relationship, and stay cacheable.

- Updated dependencies [39b2ced]
- Updated dependencies [a05a152]
- Updated dependencies [d145c9c]
  - @json-to-office/shared@1.0.0
  - @json-to-office/shared-docx@1.0.0

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
  - @json-to-office/shared-docx@0.38.1

## 0.38.0

### Patch Changes

- 5ff7bba: Give every bookmark its own `w:id`, so a cross-reference can read its target's
  text.

  `w:id` is what pairs a `w:bookmarkStart` with its `w:bookmarkEnd`, and docx
  emits `w:id="1"` for every bookmark it builds: its `Bookmark` constructor
  creates a fresh id generator per instance, so the counter never advances past
  one (dolanmiu/docx#3478, unfixed in 9.7.1). Every range in the document
  therefore opened and closed on the same id. Navigating by name still worked,
  which is why internal links and the numeric cross-reference switches looked
  healthy, but `[@id:none]` — which asks Word for the _text_ inside the range —
  rendered blank in LibreOffice, and so in every exported PDF.

  Bookmarks now take their numeric id from the render-scoped bookmark registry,
  in a range disjoint from the section bookmarks, and are emitted as an explicit
  start/end pair rather than through docx's `Bookmark`. Verified against both
  LibreOffice 25.x and the 7.4 that the hosted playground runs.

- Updated dependencies [10d3b4f]
  - @json-to-office/shared-docx@0.38.0

## 0.37.0

### Minor Changes

- 7010348: Apply `heading.props.numbering`, which the schema has always accepted and the
  renderer always ignored. `true` binds the heading to one shared multilevel
  definition — 1., 1.1., 1.1.1., with each level linked to its `Heading1`–`Heading6`
  style — so Word renders the number and keeps it right when sections move. Turn
  it on document-wide through `componentDefaults.heading.numbering`; `false` opts
  a single heading out. A numbered heading's number also joins its cached TOC
  entry, which is what keeps the cached copy and Word's own refresh in agreement.

  Add `[@id]` cross-references to numbered headings and list items, alongside the
  prerequisite per-item `id` on `list` items (which also makes an item an
  internal-link target). `[@id]` writes a hyperlinked Word `REF` field carrying the
  number as a cached value, so the PDF path — headless LibreOffice, which never
  updates fields — shows it too; `:no_context`, `:full_context` and `:none` select
  the other switches. A reference to an unknown id renders as literal text with a
  warning rather than as Word's "Error! Reference source not found".

  Add `text-box` `renderAs: 'shape'`, which emits a native Word text box (a WPS
  DrawingML shape) instead of the default borderless one-cell table: real wrap
  modes and z-order, at the cost of autofit, per-side borders and lazily-resolved
  percentage sizes. `'table'` remains the default and is unchanged. Shape mode
  falls back to the table rendering, with a warning, for content a shape cannot
  hold (a nested `columns`) or a missing `width`/`height`.

### Patch Changes

- Updated dependencies [7010348]
  - @json-to-office/shared-docx@0.37.0

## 0.36.1

### Patch Changes

- 58a9e82: Rasterize the fallback image an inline `svg` ships for readers that cannot draw
  the vector.

  A `w:drawing` for an SVG carries two payloads: the vector, which Word 2016+
  renders, and a raster fallback for everything older. `createTypedImageRun` was
  filling that fallback with the SVG bytes under a `png` type, so Word before
  2016 — and any other consumer of the package — resolved the fallback and drew
  a broken image. The TODO above it had acknowledged this since the function was
  written.

  The fallback is now a real PNG rendered with resvg, sized for the placed box at
  roughly 288 DPI and capped at 4096px on the long edge. When rasterization is
  unavailable or the markup will not parse, the run keeps the historical bytes
  and reports an `IMAGE_SVG_RASTER_FAILED` warning: no worse than before for
  Word 2016+, and never a failed render.

  Warnings raised deep in the render now reach the caller's collector through a
  scope alongside the existing base-directory and generation-date scopes, rather
  than each intermediate signature having to carry a sink.

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

- 912f1b7: Add comment threads: replies and resolved state.

  A `comment` now accepts `replies` (in order) and `resolved`. Every comment in a
  thread anchors over the same range — how Word groups them in the review pane —
  and thread parentage is derived rather than authored: the renderer allocates the
  ids, sets each reply's parent, and lets docx write
  `word/commentsExtended.xml` with the `w15:paraIdParent` links and `w15:done`
  flags.

  Word threads are one level deep, so a reply carries the comment fields without
  threading of its own.

  One docx limitation is surfaced rather than swallowed: the resolved flag lives
  in `commentsExtended.xml`, which docx writes only when the document contains at
  least one reply. Setting `resolved` on a comment with no replies anywhere warns
  that the flag will not survive.

  Needs docx 9.7.1 — none of the threading machinery exists in 9.5.1.

- ea6b6af: Add Word review comments (single, unthreaded).

  `heading`, `paragraph`, `list` and table cells (header and body) accept a
  `comment` prop — `{ text, author?, initials?, date? }`. The commented runs are
  wrapped in a `w:commentRangeStart` / `w:commentRangeEnd` pair followed by a
  `w:commentReference` run, with the body written to `word/comments.xml`. A
  list-level comment spans the whole list: the range opens on the first rendered
  item and closes on the last.

  Comment ids come from their own registry — a separate OOXML namespace from the
  `w:ins`/`w:del` ids, but the same per-render async-local scoping, so concurrent
  generations cannot interleave counters. Author and date default to stable
  values so identical input still produces identical bytes.

  Supporting changes:

  - `componentDefaults` now rejects `comment` as well as `revision`. Both come
    from one exported `PER_INSTANCE_PROPS` list, and the regression test is driven
    by that list so a future per-instance prop cannot be forgotten.
  - New `'comment-ids'` cache-bypass reason (`ComponentBypassReason`), so a
    commented component is never served from the cross-document cache.
  - The document differ no longer reports a changed `comment` as an untracked
    formatting change.
  - Dropped the vestigial `includeComments` request flag: comments are authored on
    the components that carry them, so a request-level toggle has nothing to mean.
    The options object stays open, so existing callers are unaffected.

- 234a97e: Add endnotes.

  A `paragraph` now accepts `endnotes` alongside `footnotes`, with the same
  `[{ id, text }]` shape and the same `[^id]` markers. The two differ only in
  where Word puts the body: the foot of the page, or the end of the document.

  - An id resolves against `footnotes` first, then `endnotes`. Declaring the same
    id in both warns and uses the footnote, so the result does not depend on prop
    order.
  - Footnotes and endnotes number independently — they are separate OOXML parts —
    and both are emitted only when a marker actually resolves to them.
  - Endnote text picks up the theme's `normal` style two points smaller, through
    Word's built-in `EndnoteText` / `EndnoteReference` styles.

  The note schema and resolver are shared rather than duplicated:
  `schemas/components/footnote.ts` becomes `note.ts` (exporting `NoteSchema`,
  `FootnotesSchema`, `EndnotesSchema`) and `footnoteResolver.ts` becomes
  `noteResolver.ts`. `endnotes` joins the per-instance props excluded from
  `componentDefaults`.

  Needs docx 9.7.1: `IPropertiesOptions.endnotes` does not exist in 9.5.1.

- 34fdb52: Add footnotes.

  A footnote is authored in two halves: an inline `[^id]` marker in a
  `paragraph`'s text and the body declared on the same paragraph via a new
  `footnotes` prop (`[{ id, text }]`). The marker renders as a
  `w:footnoteReference` and the body lands in `word/footnotes.xml`, so Word
  numbers the notes and places them at the foot of the page.

  - `[^id]` is only syntax where footnotes are declared, so existing documents —
    including prose containing regex character classes like `[^a-z]+` — are
    untouched.
  - Numbering follows reference order; a body no marker resolves to is not
    emitted and is reported. A repeated marker reuses the same note.
  - Markers resolve at the leaf of the text parser, so `**bold[^n]**` keeps its
    emphasis and a marker beside a link still works. They are not recognised in
    text that also carries `{PLACEHOLDER}` substitutions, which now warns instead
    of failing silently.
  - Footnote ids come from a per-render async-local registry, so concurrent
    generations cannot cross-reference each other's bodies.

  `createWordStyles` now always emits the `default` styles key rather than only
  when a document language is set, and fills in the `footnoteText` /
  `footnoteReference` hooks from the theme's `normal` style two points smaller —
  otherwise notes would render in Word's default font rather than the document's.

- 5ea33ff: Add per-level marker styling to lists.

  A list level now accepts a `font` (`family`, `size`, `color`, `bold`, `italic`,
  `underline`) that maps to the numbering level's own run properties, so the
  number or bullet glyph can carry a font, size, weight or colour independent of
  the list text. `color` accepts a hex value or a theme colour token like every
  other colour in the schema. This was the one thing about list markers that was
  previously inexpressible: numbering only ever emitted paragraph indentation.

  Levels without a `font` emit exactly the XML they did before.

- 98ca046: Harden the render cache against document-scoped ids leaking across documents.

  - `componentHasRevision` now descends `props.columns[].header`,
    `props.columns[].cells[]` and any component nested in a cell's `content`, plus
    a row-parallel `props.rows[]`. Tables are cacheable, so without this a table
    carrying tracked changes would be served from the cross-document cache and
    replay dead `w:ins`/`w:del` ids into later documents.
  - The cache-bypass ladder is extracted from `renderComponentWithCache` into a
    named, exported `componentBypassReason(component)` predicate so new bypass
    reasons are a new clause rather than a restructuring.

- 51f958a: Add table row insert/delete and cell text revisions, and teach the differ to
  diff tables row by row.

  **Authoring.** The table model is column-major, so anything belonging to a whole
  row lives in a new row-parallel `props.rows` array indexed like
  `columns[].cells`: `{ revision?, cantSplit?, tableHeader? }`. A row `revision`
  is structural (`{ type: 'insert' | 'delete', author?, date? }`) — the existing
  `Revision` shape cannot express it, since it requires text segments. Cells now
  also accept a `revision` of their own, so a plain string cell can carry tracked
  changes without being wrapped in a paragraph.

  Marking a row deleted emits both halves Word needs: `w:trPr/w:del` **and** every
  cell's runs and closing paragraph mark marked deleted. Without the second half,
  accepting the change leaves an empty row behind instead of removing it. An
  inserted row is marked symmetrically.

  **Differ.** `diffDocuments` no longer treats a column-based table as opaque. It
  builds a row-major view, aligns rows on their markdown-stripped cell texts, and
  pairs unmatched runs — so a rewritten row becomes cell-level word changes rather
  than a delete plus an insert. A deleted table is kept in the redline with every
  row marked deleted rather than being dropped. Column-count changes, header-row
  changes and the legacy `{ headers, rows }` shape stay on the block-replace path
  and are reported in `summary.untracked`.

  **Not included**, and reported as untracked: cell merging (the schema has no
  merge state for a revision to describe) and the `*PrChange` family, which would
  require the differ to synthesise a fully-resolved old-version options object.

  `rows` is excluded from `componentDefaults.table`: `Type.Partial` is shallow and
  `rows` is optional on a table, so a theme could otherwise mark the same row of
  every table inserted or deleted. `columns` is deliberately left alone — theme
  defaults replace arrays wholesale rather than merging them element-wise, and
  `columns` is required on every table, so a theme's `columns` (and any comment or
  revision inside it) can never reach one.

- baf0fc8: Add `between` to the theme border schema.

  A style's `borders` now accepts `between` alongside `top`/`bottom`/`left`/
  `right`, mapping to OOXML `w:between` — the rule Word draws between consecutive
  paragraphs that share the border set, in place of their adjoining bottom and top
  edges. Same shape as the per-side definitions, including theme colour tokens.

  This is the theme border schema only; the paragraph component has no `border`
  prop and this does not add one.

  Needs docx 9.7.1: `IBordersOptions.between` does not exist in 9.5.1.

- ed9ba39: Write TOC fields with their entries already cached, so a headless PDF renders a
  real table of contents.

  `updateFields: true` asks Word to repopulate every TOC on open, and Word
  obliges — but headless LibreOffice does not, so a TOC field with no cached
  content exported as just the word "Contents". The rasterizer path goes through
  soffice, so this was the case that bit.

  A new pre-pass collects the entries before rendering and `renderTocComponent`
  passes them to docx as `cachedEntries`. The collector walks the layout the way
  the renderer does:

  - headings, including those nested in a `text-box`;
  - paragraphs whose `themeStyle` a TOC maps through `props.styles` — Word
    includes those via the `\t` switch, so a heading-only pass would have made the
    cached entries disagree with Word's own refresh;
  - never headers or footers (a heading there renders as nothing);
  - disabled subtrees pruned.

  Entries are filtered per TOC by depth range, style mapping and — for a
  section-scoped TOC — the section bookmark. Titles have their markdown
  decorators stripped the same way `createHeading` does. Page numbers and entry
  hyperlinks are deliberately omitted: nothing in generation paginates, and Word
  fills real numbers in on refresh.

  Existing TOC-bearing documents change from a two-empty-paragraph field block to
  N styled entries.

### Patch Changes

- 2ea0f6a: Emit TOC level styles under the canonical `TOC1`..`TOC6` ids.

  They were namespaced as `JTD_TOC1`..`JTD_TOC6` defensively, but docx hardcodes
  `w:pStyle w:val="TOC{level}"` when it writes cached TOC entries, so the
  namespaced ids would leave every cached entry unstyled. docx's own default
  styles define no TOC id, so the collision the prefix guarded against does not
  exist. Display names (`TOC 1`..`TOC 6`) are unchanged.

- 4d7c554: Render tracked changes on paragraphs inside table cells.

  `processCellContent` read only `props.text`, so a cell paragraph carrying a
  `revision` rendered as plain text — the tracked change was dropped with no error
  or warning, even though the schema accepts `revision` on paragraphs wherever
  they appear. Cell paragraphs now take the same revision-aware path `createText`
  uses and emit `w:ins` / `w:del` inside `w:tc`. Header cells too.

- 7900859: Fix floating-image `wp:docPr` renumbering when `id` is not the first attribute.

  The renumbering pass matched `<wp:docPr id="…"` only, so it silently became a
  no-op if docx ever emitted the attributes in a different order — every floating
  image would keep `id="1"` and Word would prompt to repair the file, with the
  whole test suite still green. The match now anchors on the element name and
  finds `id` wherever it sits, preserving attribute order. Adds
  `floating-docpr-uniqueness.test.ts`, which asserts docPr id uniqueness for a
  generated document — the invariant no test covered before.

- 1f4e1a5: Honour list `props.start` when an explicit `props.levels` array is supplied.

  `start` was only read while building levels from the simplified props, so a list
  that declared its own `levels` discarded it silently — contradicting the
  documented "Level-0 starting number". It is now folded into level 0, and a
  `start` declared on the level itself still wins.

- ed54627: Emit `w:pgSz/@w:code` for the standard page sizes.

  A4, A3, Letter and Legal now carry their DEVMODE paper-size code (9, 8, 1, 5),
  so printer drivers can pick the right tray instead of inferring it from the
  dimensions. The code is derived from the named size — there is no schema change
  and it is never authored.

  A custom `{ width, height }` deliberately carries no code. The section-level
  `page.size` override now replaces the base size wholesale rather than merging
  into it, which is what stops the theme's paper code leaking onto a custom page
  and sending the driver after the wrong paper.

  This needed docx 9.7.1: 9.5.1 typechecked `code` but dropped it before writing
  the section properties.

- bae9e20: Review follow-ups on the docx issue batch:

  - **Comments survive two paths that dropped them.** A comment on a paragraph
    whose text is markdown list syntax reached `createList` without it, and a
    comment on a table cell with no content was lost to the empty-cell early
    return. Both now anchor — the empty cell as a zero-length range plus its
    reference, which is what Word writes for a comment on an empty selection.
    Footnotes and endnotes now resolve on the markdown-list path too.
  - **Notes alongside `revision` are announced, not swallowed.** Tracked-change
    text renders literally, so a `[^id]` marker inside it cannot resolve; the
    combination now warns and names the notes that will be dropped.
  - **Duplicate note ids resolve first-declaration-wins**, within one array as
    well as across `footnotes` and `endnotes`, and warn. Previously a duplicate
    inside one array silently replaced the earlier body.
  - **Cached TOC entries match a style mapping written either way.** `themeStyle`
    carries the theme key while `toc.styles[].styleId` may name the Word display
    name the `\t` switch needs; both forms are now indexed and looked up, so the
    cached entries no longer omit a row Word adds on refresh.
  - **The table differ keeps authored row properties.** `cantSplit`,
    `tableHeader` and the rest travelled by index, which the diff invalidates by
    reinserting deleted rows; they now travel with their row and the diff's
    revision mark merges on top.
  - **The table differ reports markdown-only edits**, matching the paragraph and
    list paths: a cell whose raw text changed but whose rendered text did not, and
    markdown flattened inside a revised cell, are both surfaced in
    `summary.untracked` instead of passing silently.
  - **`includeComments` is restored as a deprecated no-op** rather than deleted.
    It never did anything, but `GenerateDocumentRequest` is a published type and
    removing the field narrowed it under callers that still pass it.
  - Fixed the cross-process determinism test on Windows: it resolved the
    `node_modules/.bin/tsx` shell shim, which exists but cannot be spawned there,
    and embedded a bare Windows path as an ESM specifier.

- 9e14e7a: Collapse the duplicated `PAGE_SIZES` table into one source of truth.

  `core/layout.ts` carried an inline copy of the A4/A3/Letter/Legal twip
  dimensions alongside the one in `styles/utils/layoutUtils.ts`, so the two could
  drift. `getPageDimensions` and `PAGE_SIZES` are now exported from the styles
  barrel and the inline copy is gone. Also corrects two comments that labelled
  A4's 11906x16838 as "Letter size".

- 58f5331: Collapse the two `sectionBookmarkId` producers into one.

  `context.section.sectionBookmarkId` was written by two independent counters over
  two different traversal orders — a loop-carried fold in `core/render.ts` and a
  DFS counter on `context.custom.sectionBookmarks` in `components/section.ts` —
  with the second shadowing the first, and one consumer (the section-scoped TOC)
  reading whichever won. Both call sites now allocate from a single
  `globalSectionBookmarkRegistry`, which owns both id namespaces and their
  disjoint numeric link-id ranges, and remembers what each section resolved to.

  The ordinal fold is extracted to `core/sectionOrdinals.ts` as a pure function
  over the layout chunk list. Generated output is byte-identical.

- Updated dependencies [ae9b1d4]
- Updated dependencies [912f1b7]
- Updated dependencies [ea6b6af]
- Updated dependencies [234a97e]
- Updated dependencies [34fdb52]
- Updated dependencies [5ea33ff]
- Updated dependencies [4bfe683]
- Updated dependencies [bae9e20]
- Updated dependencies [51f958a]
- Updated dependencies [baf0fc8]
- Updated dependencies [ed9ba39]
  - @json-to-office/shared-docx@0.34.0

## 0.33.0

### Patch Changes

- Updated dependencies [2ae9268]
  - @json-to-office/shared@0.33.0
  - @json-to-office/shared-docx@0.33.0

## 0.32.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [b2b0bd3]
  - @json-to-office/shared-docx@0.32.0

## 0.31.0

### Minor Changes

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

## 0.30.0

### Minor Changes

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
  - @json-to-office/shared-docx@0.29.0

## 0.28.0

### Minor Changes

- a033a8b: Relative image/media paths now resolve against the document's own directory instead of `process.cwd()` (#142). New `baseDir` option on core generation (`generateBufferFromJson` et al.), plugin builders (constructor + per-call), CLI `generate` (auto-set to the input file's directory), the playground server (via `options.sourceName` mapped through discovery), and the pptx rasterizer request (docx `visual` components forward it). cwd stays the fallback when no baseDir is provided. Stock template media paths shrunk to document-relative `media/...`; stale `templates` entry dropped from `packages/jto` package `files`.

### Patch Changes

- Updated dependencies [a033a8b]
  - @json-to-office/shared@0.28.0
  - @json-to-office/shared-docx@0.28.0

## 0.27.0

### Minor Changes

- 43defd5: Plugin builders: a document explicitly naming a known built-in theme now gets that built-in, instead of being shadowed by the constructor `theme` object. The constructor object still applies when the document names no theme or names something nothing recognizes (unknown-name fallback preserved). customThemes entries keep top precedence. Same contract in DOCX and PPTX.

## 0.26.1

### Patch Changes

- fc2d91b: Extract the duplicated tab-splitting line-run builder shared by the plain-text and placeholder paths into `buildRunCommonProps` / `buildTextRuns` (textParser), so run-level properties can no longer drift between the two paths. No behavior change; parity now pinned by tests for every run-level prop.

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

- Updated dependencies [2801ec4]
- Updated dependencies [96c30b3]
  - @json-to-office/shared-docx@0.25.0
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

- Updated dependencies [5e6f5df]
  - @json-to-office/shared-docx@0.24.0

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

- e311268: feat(docx): write `props.metadata` into the document properties

  `metadata` was accepted, validated, and then dropped: `new Document({…})` was constructed without any core properties, so nothing the author wrote reached the `.docx`. Word showed an empty Properties panel and the fields were invisible to search and DMS indexing.

  The generated package now carries them: `title`, `subtitle` → `dc:subject`, `description`, `author` → `dc:creator` and `cp:lastModifiedBy`, `tags` → `cp:keywords`, and `company` plus `version` as `Company` / `Version` entries in `docProps/custom.xml` (Word has no core-property slot for either). Documents that set `metadata` therefore produce different bytes than before, and generation stays deterministic.

  **`metadata.created` and `metadata.modified` are removed from the schema.** They could not be honoured: docx stamps `dcterms:created` / `dcterms:modified` with the wall clock and exposes no override, so the values were silently discarded on every build. Because `metadata` is `additionalProperties: false`, a document that still sets them now fails validation with `Document validation failed` instead of being accepted and ignored — the rendered bytes are identical either way. Delete the two keys; set the package timestamps through the `generatedAt` generation option, which is what controls them. `validation.allowUnknownFields: true` strips them if you need a stopgap.

  `metadata.date` is unaffected: it drives `{DATE}` / `{DATETIME}` placeholder resolution, not the package timestamps. The schema descriptions now say where each field lands.

- e311268: fix(docx): apply theme `componentDefaults` to components written without a `props` key

  `resolveComponentDefaults` returned early when a component had no `props` key at all, so theme defaults reached `{"name": "section", "props": {}, …}` but not `{"name": "section", …}`. A missing `props` is now treated as `{}`, and every component picks up its theme defaults regardless of how it was written.

  **The root `docx` node no longer crashes without `props`.** `validateDocument` / `validateJsonComponent` accept a propless root, but generation then read `document.props.theme` unguarded and died with `TypeError: Cannot read properties of undefined (reading 'theme')`. Both entry points — `generateDocumentWithCustomThemes` and the plugin builder in `createDocumentGenerator` — now normalise a missing root `props` to `{}` before anything downstream touches it, which also covers the unguarded reads in `processDocument` (`componentDefaults`, `noProofWords`, `trackRevisions`, `language`, `metadata`). This only widens what generates: a root that carries `props` keeps its object identity, so every existing output is byte-for-byte unchanged, and a propless root now produces bytes identical to the same document written with `"props": {}`.

  Note that the published DOCX JSON Schema still marks the root's `props` as required, so an editor honouring `$schema` flags a propless root that the library now happily builds. Writing `"props": {}` remains the correct thing to do; reconciling the two layers is a separate change.

  **This repaginates existing documents.** A titleless `section` with no `props` key used to miss `componentDefaults.section` and fall back to the built-in `pageBreak: true`, starting a new page. All five bundled themes set `section.pageBreak: false`, so those sections no longer break the page. Write `"props": { "pageBreak": true }` on the section to get the page break back. The same correction applies to every other component with theme defaults (`heading`, `paragraph`, `image`, `statistic`, `table`, `columns`, `list`) — a propless node now inherits them.

  The bundled themes also drop five `componentDefaults.table` keys that no renderer ever read and that the theme schema rejects: `borders`, `striped`, `headerBackground`, `headerColor`, and `borderWidth`. All five bundled themes now pass `validateThemeJson`, which they did not before; rendering is unchanged, because nothing consumed those keys. If you copied a bundled theme as a starting point, remove them — the settings that do exist are `componentDefaults.table.headerCellDefaults.backgroundColor` / `.color`, `hideBorders`, and `borderSize`. There is no theme-level row striping.

  The same treatment now reaches the document root, and the exported JSON Schema agrees: `props` is marked optional there, so a schema-driven editor no longer flags a propless root that the generator accepts. Only an absent or `undefined` `props` is defaulted — an explicit `null`, `false` or `""` stays as written and is rejected by validation instead of being rewritten into a valid shape.

- e311268: fix(docx): repeat table headers by default, and resolve cell colours through the theme

  Two table fixes that change how already-shipped documents render.

  **Header rows now repeat across page breaks.** `repeatHeaderOnPageBreak` has carried `default: true` in the exported JSON Schema since it was introduced, but `createTable` forwarded the raw prop to docx, so an omitted value meant "do not repeat" — the schema and the renderer disagreed. Any table that spans a page break and never set the prop explicitly will now show its header row at the top of each page. Set `"repeatHeaderOnPageBreak": false` on the table to keep the old rendering. The prop description (which said "Defaults to false") now matches the schema.

  **Cell `color` / `backgroundColor` accept theme colour names.** Both were handed to docx verbatim, so only a 6-digit hex (with or without `#`) and `"auto"` ever produced a file: a theme colour name such as `"primary"`, a CSS keyword, or a typo aborted generation with docx's internal `Invalid hex value 'x'. Expected 6 digit hex value`. They now resolve the same way paragraph and heading colours do — theme colour name or `#RRGGBB` — with bare 6-digit hex and `"auto"` still accepted. Bare hex is normalised to uppercase on the way through, as `#RRGGBB` values already were, so a cell written `"backgroundColor": "abc123"` now reaches docx as `ABC123`. An unresolvable value still stops generation, but with a message that names the offending prop and lists what it accepts.

  `"transparent"` is a `backgroundColor`-only sentinel (it is consumed at the shading site and has no `w:color` meaning). On `backgroundColor` it behaves as before; on `color` it used to abort generation inside docx and is now ignored, with a `TABLE_CELL_COLOR_INVALID` warning, so the cell's text takes the table style's colour. Documents that set `color: "transparent"` on a cell previously failed to build and will now build — check those cells if you were relying on the failure.

### Patch Changes

- e311268: fix(docx): stop the schema promising things the renderer does not do

  **`text-box` `style.shading.fill` is now typed as a colour.** It was a bare `Type.String()`, but the value goes to `resolveColor`, which accepts `#RRGGBB` or a theme colour name and throws on everything else. Malformed fills therefore passed validation and blew up mid-render. `fill` now shares `HexColorSchema` with the border colours next to it, so those values are rejected up front — by `jto docx validate` and in the playground — instead of at generation time. Nothing that used to render stops rendering: `resolveColor` never accepted the newly rejected shapes (`rgb(…)`, `#abc`, digit-leading bare hex like `0F0FDF`) in the first place. If a document of yours starts failing validation here, it was already failing to generate.

  **`toc` `numberingStyle` is documented as the no-op it is.** Word's table-of-contents field carries no numbering switch — entries inherit numbering from the heading styles they point at — so the renderer has never been able to apply this prop. It stays in the schema for compatibility, its description now says so, and setting it logs a warning during generation rather than being silently swallowed. Remove it from your documents; control TOC numbering through the heading styles instead.

  `resolveColor` also accepts a bare 6-digit hex (`F0FDF4`). The shared colour pattern admits a letter-leading bare hex through its theme-name branch, so that shape used to validate and then throw mid-render; table cells and the chart palette already special-cased it. No theme colour name is six hex characters, so there is no ambiguity. `isValidColorName` / `getAvailableColorNames` now follow the reference chain too, so a token aliased to an unset slot is no longer reported as usable.

- Updated dependencies [e311268]
- Updated dependencies [e311268]
- Updated dependencies [e311268]
- Updated dependencies [e311268]
  - @json-to-office/shared@0.22.0
  - @json-to-office/shared-docx@0.22.0

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
  - @json-to-office/shared-docx@0.21.0
  - @json-to-office/shared@0.21.0

## 0.20.0

### Minor Changes

- bc15ebf: feat(docx,pptx): highcharts charts follow the document theme by default

  The `highcharts` component forwarded its config verbatim, so charts with no explicit `colors` rendered in the Highcharts default palette (blue-first) regardless of theme. When `options.colors` is absent, the renderer now injects the theme palette — pptx uses the same token list as the native `chart` component (primary, secondary, accent, accent4-6); docx uses primary/secondary/accent. Explicit `colors` always wins, so existing configs that set colors are unchanged.

### Patch Changes

- @json-to-office/shared-docx@0.20.0

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
  - @json-to-office/shared-docx@0.19.0

## 0.18.0

### Minor Changes

- a079015: feat: forward `resources` from the highcharts component to the export server, and accept raw inline SVG markup as an image source (docx + pptx)

  **Highcharts `resources` (docx + pptx).** The `highcharts` component gains an optional `resources` prop (`{ css?, js?, files? }`) that is passed through verbatim to the Highcharts Export Server's `/export` payload. This unlocks the server's native `resources` contract — notably `@font-face` rules in `css` pointing at web-hosted `.woff2` files, so charts can render in custom fonts (e.g. Manrope, Carlito). Fully backward compatible: when `resources` is omitted the request body is byte-identical to before (no `resources` key sent). The object is forwarded as-is — no transform, re-serialize, or key stripping. In docx, `resources` is part of the component props, so it is already part of the render cache key — two charts differing only by `resources` are not deduped to the same image.

  **Inline SVG image source (docx + pptx).** The `image` component gains an `svg` prop alongside `path`/`base64`, so callers can drop raw `<svg>…</svg>` markup straight into the JSON instead of encoding it as a data URI or pointing at a file. Source precedence is `svg > base64 > path`; the markup is wrapped into an `image/svg+xml` data URI and flows through the existing pipeline. In docx it renders as a true vector (Word 2016+, with the usual PNG fallback) and honors width/height (intrinsic viewBox size when omitted), `%` widths, alignment, caption, floating, and table-cell placement; resolution is centralized in a shared `resolveImageSource()` helper used by every image render path (block, table cell, column layout), and document validation rejects an image that sets more than one of `path`/`base64`/`svg` with a path-aware error. In pptx the same `svg` source is embedded as a vector (PowerPoint 2016+, with pptxgenjs's PNG fallback) and participates in intrinsic-aspect auto-sizing (e.g. width-only → height derived from the viewBox) via the same precedence helper. Adds an `eldermoor-census` example custom component (docx) demonstrating how to expose structured data props and render them via the inline `svg` image source.

### Patch Changes

- Updated dependencies [a079015]
  - @json-to-office/shared-docx@0.18.0

## 0.17.3

### Patch Changes

- f5a6468: fix(docx): honor lineSpacing and spacing on header/footer paragraphs

  Paragraph modules in a section `header`/`footer` were rendered by a separate, minimal code path that only read font (family/size/bold/italic/color), text, and alignment. Any `font.lineSpacing` or paragraph `spacing` (before/after) set on a header/footer paragraph was silently dropped — it never reached the emitted OOXML.

  Header/footer paragraphs now render through the same `createText` primitive as body paragraphs, so they honor `lineSpacing`, `spacing`, and the full font set (also `underline`, `boldColor`, `fontWeight`). Run-level font/size/color resolution against the theme's Normal style is preserved, so existing documents render unchanged unless they set these previously-ignored properties. Markdown link syntax in header/footer text is now parsed into hyperlinks, matching body paragraphs.

## 0.17.1

### Patch Changes

- cfff3aa: fix(docx): validate standard nodes emitted by a custom component's render()

  Generation validation (default on) only validated the input document, before component expansion. A standard component emitted by a custom component's `render()` was never schema-checked, so a document could generate "successfully" while its `standardDefinition` failed standard-schema validation (e.g. when pasted into the playground).

  Each `render()`'s emitted tree is now validated at the boundary with the same gate authored standard components pass through, and the error names the emitting component (`custom component '<name>' emitted invalid output — …`). Honors `validation.enabled` and `validation.allowUnknownFields` like the rest of the pipeline.

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
