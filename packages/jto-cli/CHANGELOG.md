# @json-to-office/jto-cli

## 0.11.0

### Minor Changes

- 7f9679b: Introduce `@json-to-office/jto-cli`, a lightweight CLI package containing only the non-playground commands (`generate`, `validate`, `schemas`, `discover`, `init`, `fonts`). Install it instead of `@json-to-office/jto` in CI or scripting contexts to skip the React/Monaco/Vite/AI-SDK playground deps.

  `@json-to-office/jto` is unchanged for users — it now depends on `jto-cli` and adds the `dev` playground command on top, so `jto docx dev` / `jto pptx dev` still work as before.

  Note: the binary in `@json-to-office/jto-cli` is `jto-cli`, not `jto` — update CI scripts that previously invoked `jto` accordingly.
