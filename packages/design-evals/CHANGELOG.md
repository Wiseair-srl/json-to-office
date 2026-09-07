# @json-to-office/design-evals

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
