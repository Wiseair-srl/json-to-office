---
'@json-to-office/core-docx': minor
'@json-to-office/shared-docx': minor
---

Centralize component-defaults resolution into a single tree walk (`resolveComponentTree`) before rendering, removing per-component `resolveXxxProps` calls from individual renderers. Support document-level `componentDefaults` override in report props.
