# @json-to-office/design-evals

## 5.0.0

### Patch Changes

- Updated dependencies [3e7ad98]
  - @json-to-office/mcp-server@5.0.0
  - @json-to-office/jto-ops@5.0.0

## 4.4.5

### Patch Changes

- 0f1db3b: The harness records render-environment failures the agent met (a Highcharts export server refusing or unreachable) as `environmentFailures` on each run and as a count on the scorecard, with a warning above the judge line: such a run may still deliver, with its charts dropped, but it is not comparable to one on a healthy host. The page-fill finding's advice now says merge the section, not pad it.

## 4.4.3

### Patch Changes

- c634a82: `pnpm rejudge` re-judges every pass of a `--repeat` set, reading each sheet from `runs/<brief>#<pass>` the way the runner wrote it; before, it kept one record per brief and looked for `runs/<brief>`, so a repeated set came back as "no contact sheet" for every document. Rejudged rows carry the run label.

## 4.2.0

### Patch Changes

- 829e982: Rendered pass (#344) under the quality contract. The pass is now a rule pack (`RENDERED_QUALITY_RULES`) run through the quality engine, so profiles, suppressions, severity overrides and gates apply to rendered findings; `jto_preview` takes the same `quality` option as `jto_validate`, judges by the document's declared profile or the format default otherwise, and reports `rendered.suppressed`, `rendered.blocked` and `rendered.profileId`. The design guide lists the rendered rules. A rendered preview prepares the document once and both generates from and maps through that prepared model. The DOCX text inventory covers a contents field (optional entries where it renders, scoped and depth-limited as the field is) and a native chart's title and axis titles, so neither steals a heading's first occurrence. A labelled mapping corpus (duplicates, contents page, ligatures, chrome around a split paragraph, a declared font that cannot load, chart titles, a truncated frame) scores mapping precision and recall at 1.0 against the ≥0.95 / ≥0.90 targets.
- Updated dependencies [829e982]
  - @json-to-office/jto-ops@4.2.0
  - @json-to-office/mcp-server@4.2.0

## 4.1.0

### Minor Changes

- c507e21: Rendered-certainty pass (#344, report prototype). `jto_preview` gains `renderedFindings: true`: the PDF LibreOffice produced is read for word geometry (`pdftotext -bbox-layout`) and embedded fonts (`pdffonts`), and `jto-ops` turns them into quality findings with `certainty: "rendered"` — text cut off or truncated (`W_QUALITY_RENDERED_CLIP`), a framed paragraph or text box drawn past its declared box (`W_QUALITY_RENDERED_SPILL`), words drawn over each other (`W_QUALITY_RENDERED_OVERLAP`), authored text that never rendered (`W_QUALITY_RENDERED_TEXT_MISSING`), substituted families (`W_QUALITY_RENDERED_FONT_SUBSTITUTED`, information unless the document declared a source), empty pages, stranded headings and split paragraphs. Findings map to authored pointers through a new `docx/text` inventory fact (every painted string with its role, through the block source maps) and reading-order matching that handles duplicate strings, ligatures, page-broken paragraphs and partial clipping; each carries `context.mapping` and unmapped findings stay visible at the document root. Geometry is cached beside the page count. The design-evals scorecard counts rendered findings by mapping outcome and includes the rendered integrity codes in its defect rate.

### Patch Changes

- Updated dependencies [c507e21]
  - @json-to-office/jto-ops@4.1.0
  - @json-to-office/mcp-server@4.1.0
  - @json-to-office/quality@4.1.0

## 4.0.0

### Patch Changes

- Updated dependencies [e29475b]
- Updated dependencies [102ab50]
  - @json-to-office/mcp-server@4.0.0
  - @json-to-office/quality@4.0.0
  - @json-to-office/jto-ops@4.0.0

## 3.0.0

### Patch Changes

- Updated dependencies [1812512]
- Updated dependencies [4807d5d]
- Updated dependencies [7143379]
  - @json-to-office/mcp-server@3.0.0
  - @json-to-office/quality@3.0.0
  - @json-to-office/jto-ops@3.0.0
