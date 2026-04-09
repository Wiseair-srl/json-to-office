# @json-to-office/shared-pptx

## 0.7.0

### Patch Changes

- Updated dependencies [c0bd927]
  - @json-to-office/shared@0.7.0

## 0.3.0

### Minor Changes

- de674e0: feat(schema): per-container narrowed children validation for DOCX and PPTX

  Each container component now declares its `allowedChildren`, and the schema
  generator builds per-container children unions instead of one flat recursive
  union. Monaco immediately flags invalid nesting (e.g. heading inside docx).

  Also skips auto-builds when JSON is syntactically invalid or has schema
  validation errors, preventing wasted server roundtrips during typing.

## 0.2.0

### Patch Changes

- Updated dependencies [1db99a3]
  - @json-to-office/shared@0.2.0
