---
'@json-to-office/shared': patch
'@json-to-office/shared-docx': minor
'@json-to-office/shared-pptx': minor
'@json-to-office/core-docx': minor
'@json-to-office/core-pptx': minor
'@json-to-office/json-to-docx': minor
'@json-to-office/json-to-pptx': minor
'@json-to-office/jto-cli': patch
---

Document JSON can now select its renderer with an optional top-level
`renderer` discriminator. Omission selects `docxjs` for DOCX and `pptxgenjs`
for PPTX. Generated schemas, runtime validation, autocomplete and exported
renderer-profile types derive backend-specific branches from the canonical
component schemas; compiler capability checks remain authoritative after custom
component expansion and asset resolution.

Runtime custom-component schemas are rebuilt from the current plugin
definitions, so reloading the same component name and version cannot reuse stale
props or child metadata.
