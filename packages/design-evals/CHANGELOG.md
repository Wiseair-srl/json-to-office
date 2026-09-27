# @json-to-office/design-evals

## 7.2.0

### Patch Changes

- 8f09402: A DOCX table cell's `content` now takes a string or one of `paragraph`, `image`, `visual` and `highcharts`, and validation refuses anything else. The schema typed cell content as any component, but a cell renders one paragraph: a `statistic`, `heading`, `list`, nested `table` or any other component came out as the grey text `[Unsupported component type: statistic]`, and nothing told the author. Three statistics set in a table as a KPI row shipped that way.

  - Validation reports `unsupported_cell_content` at the cell's `content`, once per cell, naming what a cell takes; `jto_validate` returns it as `E_UNSUPPORTED_CELL_CONTENT` with the fix in `suggestion`. A block whose output puts one in a cell is refused at the slot the author wrote. To set statistics side by side, use a `columns` component with one `statistic` per column.
  - The published schema narrows cell content the same way, so an editor offers only those four and `jto_describe_component` names them. `TABLE_CELL_COMPONENTS` exports the list.
  - A document that still reaches generation with one — a plugin's output, a caller that turned validation off — renders as before, but generation now warns `W_UNSUPPORTED_CELL_CONTENT` for each such cell, naming where it is.
  - The rendered pass gains `rendered/placeholder` (`W_QUALITY_RENDERED_PLACEHOLDER`): the placeholder on a page is reported at the cell that holds the component, or on its page when nothing in the document accounts for it. The text inventory expects the placeholder at such a cell rather than the component's own text, so the statistic's number and label are no longer reported missing. `unrenderedComponentText` and `unrenderedComponentName` in `@json-to-office/quality` spell the placeholder for the renderer and the pass alike.
  - The design evals count the new code as an integrity defect and a placeholder leak.

- Updated dependencies [8f09402]
- Updated dependencies [e7b1389]
  - @json-to-office/quality@7.2.0
  - @json-to-office/jto-ops@7.2.0
  - @json-to-office/mcp-server@7.2.0

## 7.0.0

### Patch Changes

- Updated dependencies [a599c3f]
- Updated dependencies [105b936]
- Updated dependencies [6425617]
- Updated dependencies [f0cd057]
- Updated dependencies [b822c89]
- Updated dependencies [bcc66d6]
  - @json-to-office/shared@7.0.0
  - @json-to-office/jto-ops@7.0.0
  - @json-to-office/mcp-server@7.0.0
  - @json-to-office/quality@7.0.0

## 6.0.0

### Patch Changes

- Updated dependencies [f9b6c20]
  - @json-to-office/mcp-server@6.0.0
  - @json-to-office/jto-ops@6.0.0

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
