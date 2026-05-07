# @json-to-office/jto-cli

## 1.0.0

### Minor Changes

- 755d812: refactor(core-docx)!: surface `standardDefinition` from `generate` / `generateBuffer` / `generateFile`; remove `getStandardComponentsDefinition`. Plugin `render()` previously ran twice when callers used both the inspection method and a generate call, duplicating side effects (e.g. external API hits). The post-expansion JSON tree is now returned alongside the document/buffer at no extra cost. Adapter `generateBuffer` returns `{ buffer, standardDefinition }`.

### Patch Changes

- Updated dependencies [8744ad2]
- Updated dependencies [755d812]
  - @json-to-office/shared@1.0.0
  - @json-to-office/core-docx@1.0.0
  - @json-to-office/core-pptx@1.0.0
  - @json-to-office/shared-docx@1.0.0
  - @json-to-office/shared-pptx@1.0.0

## 0.12.0

### Patch Changes

- Updated dependencies [c4a57aa]
- Updated dependencies [c4a57aa]
  - @json-to-office/core-docx@0.12.0
  - @json-to-office/shared@0.12.0
  - @json-to-office/core-pptx@0.12.0
  - @json-to-office/shared-docx@0.12.0
  - @json-to-office/shared-pptx@0.12.0

## 0.11.0

### Minor Changes

- 7f9679b: Introduce `@json-to-office/jto-cli`, a lightweight CLI package containing only the non-playground commands (`generate`, `validate`, `schemas`, `discover`, `init`, `fonts`). Install it instead of `@json-to-office/jto` in CI or scripting contexts to skip the React/Monaco/Vite/AI-SDK playground deps.

  `@json-to-office/jto` is unchanged for users — it now depends on `jto-cli` and adds the `dev` playground command on top, so `jto docx dev` / `jto pptx dev` still work as before.

  Note: the binary in `@json-to-office/jto-cli` is `jto-cli`, not `jto` — update CI scripts that previously invoked `jto` accordingly.
