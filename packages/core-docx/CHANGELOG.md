# @json-to-office/core-docx

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
