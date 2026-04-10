---
'@json-to-office/core-docx': minor
'@json-to-office/shared-docx': minor
'@json-to-office/core-pptx': minor
'@json-to-office/shared-pptx': minor
'@json-to-office/shared': minor
---

Centralize component-defaults resolution into a single tree walk (`resolveComponentTree`) before rendering, removing per-component resolve calls from individual renderers. Support document-level `componentDefaults` override in report/presentation props. Extract shared `deepMerge` utility.
