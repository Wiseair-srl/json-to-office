# @json-to-office/quality

## 2.6.0

### Minor Changes

- 22a9f62: The DOCX block tier, with its first block (#334). A block is a content
  component with bounded slots that the pipeline lowers, purely, into the
  existing primitives styled from the resolved theme. `key-takeaways` holds
  3–5 one-sentence takeaways under a label and compiles to a rule in the
  accent, the label in the theme's `label` role, a list and a closing
  hairline, all read from the theme's `chrome.keyTakeaways` recipe (with
  defaults that hold on a theme that declares none). The block stays where the
  author put it — its compiled primitives become its `children` — so every
  authored pointer keeps its address, and a source map ties each compiled node
  back to its slot: a quality finding inside the box is reported at the
  takeaway the author can patch. Too few or too many items is a schema error
  at `/props/items`; an item over 25 words is the new `W_QUALITY_SLOT_BUDGET`
  at that item. `jto_validate` gains `includeCompiled` to return the compiled
  form, its source map and the lowered blocks' pointers.

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

- 4526e5a: Three defects found reviewing this branch.

  **An off-palette fix could not repair its own finding.** `palette-adherence` emitted `{ op: 'add' }`, which is the same as `replace` on an object member and very different on an array element: RFC 6902 `add` at `/chartColors/0` _splices_, so applying the fix inserted the theme token and left the off-palette hex behind at index 1. The finding survived the patch that was supposed to remove it. Now `replace`, which is always legal here because the value was read from that exact pointer.

  **A truncated PNG decoded to a plausible-looking image.** The contact-sheet decoder's bounds check required both halves of an `&&` that could not be true together, so a short final scanline copied fewer bytes than a row and left the previous row's pixels in the buffer — the bottom of the page silently repeated instead of a refusal.

  **Judge evidence went to a directory that does not exist under `--repeat`.** The eval harness's judge derived its output path from the brief id while the runner writes to `runs/<id>#2`, so every verdict after the first pass failed on the write and was swallowed by the runner's catch. The judge is now handed its own run directory. In the same pass: a run that completed but could not be judged no longer counts as a level-1 document in the median, which reported a judge outage as a quality regression.

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

## 1.6.0

### Minor Changes

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
