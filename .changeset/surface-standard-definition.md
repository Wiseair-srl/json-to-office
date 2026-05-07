---
'@json-to-office/core-docx': major
'@json-to-office/json-to-docx': major
'@json-to-office/jto-cli': minor
'@json-to-office/jto': minor
---

refactor(core-docx)!: surface `standardDefinition` from `generate` / `generateBuffer` / `generateFile`; remove `getStandardComponentsDefinition`. Plugin `render()` previously ran twice when callers used both the inspection method and a generate call, duplicating side effects (e.g. external API hits). The post-expansion JSON tree is now returned alongside the document/buffer at no extra cost. Adapter `generateBuffer` returns `{ buffer, standardDefinition }`.
