# @json-to-office/quality

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
