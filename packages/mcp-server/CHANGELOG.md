# @json-to-office/mcp-server

## 1.10.0

### Patch Changes

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

- Updated dependencies [d76f59c]
  - @json-to-office/shared-docx@1.10.0

## 1.9.0

### Patch Changes

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

- Updated dependencies [aaab6ee]
- Updated dependencies [6bfe784]
  - @json-to-office/shared-docx@1.9.0
  - @json-to-office/quality@1.9.0

## 1.8.1

### Patch Changes

- e7f9fd8: Serialize the durable side of MCP workspaces, so concurrent tool calls cannot
  undo each other (follow-up to #290, shipped in 1.8.0).

  Tool calls are independent async tasks and agents pipeline them, which left two
  orderings broken. A `jto_workspace_close` that deleted the directory while a
  `jto_workspace_patch` was still writing could have the write recreate it, so a
  workspace the agent had been told was destroyed came back on the next use of
  the handle. And two workspaces opened at once each counted the root before
  either had created its directory, so both saw room under `maxWorkspaces` — and
  one could delete the other's half-written directory, which sorts stalest
  precisely because its metadata is not there yet.

  Every durable operation for a connection now runs through one queue, and a
  close performs its delete and its eviction in a single critical section. A
  write that reaches the front of the queue after its workspace is gone declines
  to recreate it and reports `persisted: false`, rather than claiming durability
  for a revision that was never written. The queue is root-scoped rather than
  per-handle on purpose: the count-then-prune sequence is about the root, so a
  per-handle lock would not have covered it.

  Also fixes a hazard found while tracing those: rehydrating a workspace deleted
  the whole directory whenever the head revision file was missing, which a
  concurrent prune causes benignly — a read that picked up revision N's metadata
  a moment before a save committed N+1 and pruned N. It now re-reads the metadata
  before treating a directory as torn.

## 1.8.0

### Minor Changes

- 31ee1de: MCP workspaces can now be disk-backed, so a lost client session no longer
  destroys the revisions it was holding (#290). Workspaces were memory-only:
  `entries`, `tombstones` and every pinned snapshot lived in `Map`s built per
  connection, so a host session reset, a client restart or a crash silently
  discarded all of it — in the field report this came from, five revisions of
  authoring went while the server process itself stayed alive and idle.

  Start the server with `--workspace-dir` (or `JTO_MCP_WORKSPACE_DIR`) and each
  committed revision is mirrored under that root before the tool answers. Memory
  stays the fast path; disk is durability. A reconnecting client calls
  `jto_workspace_list`, gets back every handle under the root — including ones
  this connection never opened — and reads or patches them as usual, with the
  document loaded on demand. The idle TTL still releases memory but no longer
  loses anything, and `jto_workspace_close` still destroys the work, on disk too.

  Off by default, so nothing changes for a connection that does not configure a
  root: handles stay memory-only and end with the connection.

  The root is bounded — 32 workspaces (least-recently-updated evicted first), 9
  revision files each (the head plus its pins), 16 MiB per revision — and a
  revision that cannot be written comes back as a `W_WORKSPACE_NOT_PERSISTED`
  warning with the edit applied, so durability degrades loudly rather than
  silently. Writes are atomic and ordered so the metadata never names a revision
  file that is not there, and a close that cannot delete the durable copy fails
  with `E_WORKSPACE_NOT_CLOSED` and releases nothing, rather than reporting a
  destruction that did not happen. A `workspace` record gains `persisted`,
  `jto_workspace_list` gains `persistence`, and `jto_info.workspaces` gains
  `persistent` and `root`.

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
  - @json-to-office/shared-docx@1.5.0
  - @json-to-office/jto-ops@1.5.0

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
  - @json-to-office/shared-docx@1.4.0
  - @json-to-office/shared@1.4.0
  - @json-to-office/jto-ops@1.4.0

## 1.2.0

### Minor Changes

- ad35065: Add `@json-to-office/mcp-server`: a local stdio Model Context Protocol server, runnable with `pnpm dlx @json-to-office/mcp-server` or `npx -y @json-to-office/mcp-server`, that lets an agent author, inspect, validate, preview, diff and generate `.docx` and `.pptx` as JSON.

  Tools: `jto_info` (versions, formats and their renderer ids, output root, size limits, and whether the optional preview dependencies are installed); `jto_discover` and `jto_describe_component` for progressive discovery of components, renderer profiles, themes and starters; `jto_validate`, `jto_generate` and `jto_docx_diff` for the authoring loop; `jto_preview` to render selected pages to PNG; and `jto_workspace_*` for connection-scoped documents an agent edits with RFC 6902 patches instead of resending the whole tree. The same catalogues are also published as `jto://` MCP resources for clients that read them.

  Every document-taking tool accepts either inline JSON or `{handle, revision?}`, with identical behaviour. Files are written only under a configured output root (`--output-dir`, `JTO_MCP_OUTPUT_DIR`, else a per-connection temp directory); document defects come back as path-addressed diagnostics rather than protocol errors; stdout carries protocol frames only. `jto_preview` needs LibreOffice and poppler on the host and degrades to a structured, actionable error when either is missing.

### Patch Changes

- ad35065: Make the published PPTX schema and the PPTX validator ask for the same `props`. The generated document schema marked `props` required on every component, including `slide`, whose props are all optional — so `{ "name": "slide", "children": [...] }`, a slide that validates and renders, was flagged by every editor and agent reading that schema. In the other direction the deep validator accepted a bare `{ "name": "text" }`: `text` and `runs` are both optional fields, so an empty props object passed and a missing one passed with it, and the component that exists to draw content was allowed to carry none.

  Requiredness is now one answer per component, held in the registry and read by the schema generator and the deep walk alike: `slide` may omit `props`; every other PPTX component — the `pptx` root, `text`, `image`, `shape`, `table`, `highcharts`, `chart` — must carry it, and its absence is reported as `required_property` at that node's `/props` pointer instead of passing silently.

  **Behaviour change.** Documents that already write `props` everywhere are unaffected. Documents that omitted it on a `text` or an `image` are not: generation runs the deep validator, so those used to produce a file — a slide with nothing drawn on it — and now fail validation with a pointer to the node. That is the intended outcome for `text`, whose whole purpose is the content the key carries; `image` follows because the published schema has required `props` there since it was first generated, and reading the schema's own answer instead would have loosened that contract rather than fixed the disagreement. `image` remains half enforced: the missing key is caught, an empty `"props": {}` is not, since a sourceless image is an `IMAGE_NO_SOURCE` warning at generation rather than an error.

  Three smaller divergences on the same key close with it. `"props": null` was read as an omission by the nested walk — in both formats — while the schema typed the key as an object; it is now reported as a type error at the key it was written on. A slide's `placeholders` record accepted the whole component union, so a `slide`, or the `pptx` root, could sit in a title slot: placeholder values are narrowed to what a slide's `children` accept, in the schema and the walk together, and `jto_describe_component` now names those six components in the slot's schema instead of every component there is. And a registered plugin component may no longer omit `props`, which the published plugin branch has always required — the walk checks the key's presence and leaves its contents to the plugin layer, so the failure arrives as `required_property` at the node rather than as "expected object" from inside the plugin check.

  The generated schemas also declare `$schema` as `http://json-schema.org/draft-07/schema#`, draft-07's own `$id`. The previous `https://` spelling read as an unknown dialect, so a consumer had to rewrite the field or pass `validateSchema: false` before a stock Ajv would compile the schema at all.

  Released as a minor rather than a major deliberately: every document the validator starts rejecting was already invalid against the published JSON Schema for that component, so this brings the runtime into line with the contract it documents rather than changing that contract. The one contract that does change — `slide`'s `props` becoming optional — only accepts more.

- ad35065: Prefix core generation-warning codes into the published `W_` namespace.

  The cores raise warnings under bare names (`FONT_UNRESOLVED`, `CHART_NO_DATA`),
  and `jto_generate` promoted them to a diagnostic's `code` verbatim — so
  `code.startsWith('W_')`, the test that tells an agent a diagnostic does not
  block, was false for the one class of diagnostic that never does. The codeless
  fallback was worse: it read `E_GENERATION_WARNING`, an `E_` prefix on something
  that had not stopped the render, and a code the README never listed. Warnings
  now arrive as `W_FONT_UNRESOLVED` and friends, or `W_GENERATION` when the core
  named nothing, with the core's own spelling kept on `context.code`. Unknown
  named theme fallbacks likewise use `W_UNKNOWN_THEME` rather than an `E_` code.

- Updated dependencies [ad35065]
- Updated dependencies [ad35065]
  - @json-to-office/jto-ops@1.2.0
  - @json-to-office/shared-pptx@1.2.0
  - @json-to-office/shared-docx@1.2.0
  - @json-to-office/shared@1.2.0
