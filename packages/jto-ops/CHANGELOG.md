# @json-to-office/jto-ops

## 3.0.0

### Minor Changes

- 7143379: Replace PPTX slide templates with document-local JSON blocks on the shared contract. The root `templates` array, the slide `template`, `placeholders` and `layout` props, the `MISSING_TEMPLATE`, `UNKNOWN_PLACEHOLDER` and `PLACEHOLDER_NO_POSITION` warnings and the `masters`/`placeholders` renderer capabilities are removed without aliases. A deck defines blocks in `props.blocks` and invokes them with `name: "block"`; a block expands into a transparent `group` of positioned primitives with a source map.

  New engine operations: `group` frames (nested coordinates), `direction`/`gap`/`weights` distribution, `gridConfig`, bounded text `fit` (`maxLines`, `shrink`; `text_fit_overflow` at the authored slot), definition `slide` effects (background, notes, grid) and component-slot `props` merged beneath slot content. Slot `role`s feed the new `pptx/required-chrome`, `pptx/action-title` and `pptx/slot-budget` rules; the `consulting-deck` profile requires takeaway and source and bounds the title at two lines.

  The `consulting` PPTX theme twins the DOCX house theme. The three shipped playground decks are converted; the new `consulting-deck-blocks` template carries the `action-chart` definition and `jto://blocks` lists both formats. Starters adopt the house theme. Corpus template cases are replaced by block cases with new goldens.

### Patch Changes

- Updated dependencies [1812512]
- Updated dependencies [4807d5d]
- Updated dependencies [7143379]
  - @json-to-office/shared@3.0.0
  - @json-to-office/shared-docx@3.0.0
  - @json-to-office/core-docx@3.0.0
  - @json-to-office/shared-pptx@3.0.0
  - @json-to-office/core-pptx@3.0.0
  - @json-to-office/quality@3.0.0

## 2.4.0

### Patch Changes

- 102d8a2: Three theme-loading defects, all of the same kind: a theme that validates, renders, and quietly is not what the file said.

  **DOCX theme layers were deleted between validation and the renderer.** `ensureThemeDefaults` rebuilt the theme from a hand-written literal of the ten root keys it knew about, so everything else the schema allows was dropped — `fontRegistry` and `noProofWords` on every bundled theme and every `--theme-path` render. Nothing failed: the file validated, generation succeeded, and the styling was simply absent, with no error to search for. It now spreads what it was given and backfills defaults after, at the root and inside `fonts`. `theme-round-trip.test.ts` walks `ThemeConfigSchema` and fails the day a property is added and forgotten here, which is the only moment that is cheap to fix. No shipped theme declares either key, so nothing renders differently today — this stops the next layer from vanishing the same way.

  **The PPTX theme guard checked nothing.** `isValidThemeConfig` was `typeof data === 'object' && data !== null`: `{}` came back `true`, and the caller carried on with a `ThemeConfigJson` the compiler trusted and could not read. It is now `Value.Check` against the schema, the same contract the DOCX twin has always had.

  **A PPTX `--theme-path` file was parsed but never validated.** The DOCX branch calls `loadThemeFromFile`; the PPTX branch did bare `readFileSync` + `JSON.parse` and handed the result to a compiler that reads `theme.defaults.fontSize` unguarded — so a malformed theme surfaced as a TypeError in the IR instead of a diagnostic naming the field. It now goes through `validatePptxTheme` and refuses with the first three errors, keeping the document's own theme.

- Updated dependencies [ed3a991]
- Updated dependencies [22f6f3e]
- Updated dependencies [c22a911]
- Updated dependencies [4526e5a]
- Updated dependencies [102d8a2]
  - @json-to-office/quality@2.4.0
  - @json-to-office/core-docx@2.4.0
  - @json-to-office/core-pptx@2.4.0
  - @json-to-office/shared-pptx@2.4.0

## 2.3.0

### Minor Changes

- b73f62f: `/validate` knows the plugin components the rest of the server knows.

  The dev server's `POST /api/<format>/validate` validated against the standard components alone, so a document naming a registered plugin came back `Unknown component "weather"` — the same name the schema route had just offered for completion and the generator would have expanded happily. The route now hands the registered components to the plugin-aware validator, which defers those nodes from the standard walk and checks each one's props against the version it resolves to. With no plugins registered nothing changes: `weather` is still unknown, which is the honest answer from a server that cannot build it either.

  Doing that exposed a second defect, in `core-docx`'s plugin validator itself: its walk returned at the first node that was not a custom component instead of descending, so it only ever checked components at the top level. A plugin component inside a `section` — every real document — was never validated against its props schema, by this route or by the pre-generation gate; `city: 123` passed both and failed later inside the component's own render. It now descends whatever the node is, matching what `core-pptx` already did. Custom components carried in props rather than `children` (a header, a table cell) are still outside this pass.

  `FormatAdapter` gains an optional `validateDocumentWithPlugins(doc, plugins)`, async because the core that owns the plugin-aware validators is imported on demand. Callers with an empty registry keep using the sync `validateDocument`.

### Patch Changes

- Updated dependencies [b73f62f]
  - @json-to-office/core-docx@2.3.0

## 2.0.0

### Patch Changes

- Updated dependencies [2d1a10b]
  - @json-to-office/core-docx@2.0.0
  - @json-to-office/shared-docx@2.0.0

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

### Patch Changes

- Updated dependencies [5757874]
- Updated dependencies [64b7905]
- Updated dependencies [dd0240c]
- Updated dependencies [3bfa61f]
- Updated dependencies [c6f97a0]
  - @json-to-office/core-docx@1.11.0

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

### Patch Changes

- Updated dependencies [47bd0af]
- Updated dependencies [5dc65ef]
- Updated dependencies [f6476d3]
- Updated dependencies [47bd0af]
  - @json-to-office/core-docx@1.4.0
  - @json-to-office/shared-docx@1.4.0
  - @json-to-office/core-pptx@1.4.0
  - @json-to-office/shared@1.4.0

## 1.2.0

### Minor Changes

- ad35065: Extract the host operations layer into `@json-to-office/jto-ops`: format adapters, the LibreOffice pptx rasterizer and the platform font stagers now live in a package with no terminal dependencies, so hosts without a UI can use them without pulling in ink, react, commander or chalk. `@json-to-office/jto-cli` re-exports every moved symbol at the same name, so its API is unchanged.

### Patch Changes

- Updated dependencies [ad35065]
- Updated dependencies [ad35065]
  - @json-to-office/core-pptx@1.2.0
  - @json-to-office/shared-pptx@1.2.0
  - @json-to-office/shared-docx@1.2.0
  - @json-to-office/shared@1.2.0
