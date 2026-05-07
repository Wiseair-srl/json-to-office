# @json-to-office/json-to-docx

## 0.13.0

### Minor Changes

- 755d812: feat(core-docx): surface `standardDefinition` from `generate` / `generateBuffer` / `generateFile` — the post-expansion JSON tree (custom plugins resolved) is returned alongside the document/buffer at no extra cost. Plugin `render()` previously ran twice when callers used the standalone inspection method together with a generate call, duplicating side effects (e.g. external API hits).

  `getStandardComponentsDefinition` is **deprecated** and now implemented as a thin wrapper around `generate(...).standardDefinition`. Existing callers keep working; migrate by reading `standardDefinition` directly off any `generate*` result. The method will be removed in a future major.

### Patch Changes

- Updated dependencies [8744ad2]
- Updated dependencies [755d812]
  - @json-to-office/shared@0.13.0
  - @json-to-office/core-docx@0.13.0
  - @json-to-office/shared-docx@0.13.0

## 0.12.0

### Patch Changes

- c4a57aa: chore: drop highcharts-export-server peerDependency — server is only called over HTTP, no runtime import; removes install-time approve-build warning for consumers
- Updated dependencies [c4a57aa]
- Updated dependencies [c4a57aa]
  - @json-to-office/core-docx@0.12.0
  - @json-to-office/shared@0.12.0
  - @json-to-office/shared-docx@0.12.0

## 0.9.0

### Patch Changes

- Updated dependencies [58c0fb6]
  - @json-to-office/shared@0.9.0
  - @json-to-office/shared-docx@0.9.0
  - @json-to-office/core-docx@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [b1af6ef]
  - @json-to-office/core-docx@0.8.0
  - @json-to-office/shared-docx@0.8.0
  - @json-to-office/shared@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [c0bd927]
  - @json-to-office/shared@0.7.0
  - @json-to-office/core-docx@0.7.0
  - @json-to-office/shared-docx@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [84299d3]
  - @json-to-office/shared-docx@0.6.0
  - @json-to-office/core-docx@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [b34970d]
  - @json-to-office/core-docx@0.5.0

## 0.4.0

### Minor Changes

- f6f9f3f: Re-export core generation and validation functions from public API

## 0.3.0

### Patch Changes

- Updated dependencies [de674e0]
  - @json-to-office/shared-docx@0.3.0
  - @json-to-office/core-docx@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [1db99a3]
  - @json-to-office/shared@0.2.0
  - @json-to-office/core-docx@0.2.0
  - @json-to-office/shared-docx@0.2.0
