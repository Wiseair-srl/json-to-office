# @json-to-office/jto

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
