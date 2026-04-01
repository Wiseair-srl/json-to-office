# @json-to-office/jto

## 0.5.0

### Minor Changes

- bcd6237: feat(jto): add AI feature flag (AI_ENABLED / VITE_AI_ENABLED env vars), fix prod static serving, respect NODE_ENV for config mode, add Render blueprint for DOCX + PPTX deployment
- b34970d: feat: upgrade JSON template examples to Wiseair-level quality

  - Rewrite proposal (apex theme), technical-guide (devportal theme), invoice (modern table styling)
  - Replace Charts Demo with Lumina Analytics deck (39K, 15 slides, all native chart types, grid + templates + decorative shapes)
  - Rewrite pitch-deck as Meridian Series B (29K, 9 slides, grid + templates + decorative shapes)
  - Add 4 custom themes: apex, devportal (DOCX), lumina, meridian (PPTX)
  - Modern table styling: hide vertical inside borders, cell padding, headerCellDefaults
  - Delete 7 low-quality templates: Sales Deck, Company Branding, Product Launch, Dashboard, Charts Demo, quarterly-report, annual-review
  - Remove quarterlyReportExample export from core-docx

### Patch Changes

- 9972863: fix(jto): reinforce `{ name, props }` component format in all PPTX AI prompts to prevent non-compliant template output
- Updated dependencies [b34970d]
  - @json-to-office/core-docx@0.5.0

## 0.4.1

### Patch Changes

- 5b07742: Auto-detect LibreOffice on Windows default install paths

## 0.3.6

### Patch Changes

- 985ac6c: Add explicit "no tools" instruction to AI system prompt so the model outputs JSON directly instead of complaining about missing file-editing tools.

## 0.3.5

### Patch Changes

- 8e99808: Upgrade ai 6.0.116→6.0.141, @ai-sdk/react 3.0.118→3.0.143, ai-sdk-provider-claude-code 3.4.3→3.4.4 to fix stream validation crash on tool-output-available events with providerMetadata.

## 0.3.4

### Patch Changes

- 411fa3e: Disable filesystem tools (Read, Write, Edit, Glob, Grep, Bash, Agent) in AI chat provider to prevent crash when Claude Code autonomously reads large files. Also disable session persistence and improve error detection for oversized requests.

## 0.3.3

### Patch Changes

- ce2016f: fix(jto): include prompt .md files in published package via tsup onSuccess copy
- 3553ec5: fix(jto): always show add buttons for documents and themes in sidebar

## 0.3.2

### Patch Changes

- e96c957: Upgrade Radix UI dependencies and fix vite manualChunks to scope matching to node_modules

## 0.3.0

### Patch Changes

- de674e0: feat(schema): per-container narrowed children validation for DOCX and PPTX

  Each container component now declares its `allowedChildren`, and the schema
  generator builds per-container children unions instead of one flat recursive
  union. Monaco immediately flags invalid nesting (e.g. heading inside docx).

  Also skips auto-builds when JSON is syntactically invalid or has schema
  validation errors, preventing wasted server roundtrips during typing.

- Updated dependencies [de674e0]
  - @json-to-office/shared-docx@0.3.0
  - @json-to-office/shared-pptx@0.3.0
  - @json-to-office/core-docx@0.3.0
  - @json-to-office/core-pptx@0.3.0

## 0.2.1

### Patch Changes

- 94314f8: Redesign plugin sidebar UX: inline Switch toggles, active/inactive state, split-pane detail modal

## 0.2.0

### Minor Changes

- 1db99a3: Extract shared plugin infrastructure from core-docx into shared package and add plugin system for PPTX generation

### Patch Changes

- Updated dependencies [1db99a3]
  - @json-to-office/shared@0.2.0
  - @json-to-office/core-pptx@0.2.0
  - @json-to-office/core-docx@0.2.0
  - @json-to-office/shared-docx@0.2.0
  - @json-to-office/shared-pptx@0.2.0
