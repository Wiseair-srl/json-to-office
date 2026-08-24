# @json-to-office/jto-ops

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
