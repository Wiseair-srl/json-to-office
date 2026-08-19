---
'@json-to-office/core-docx': minor
---

Harden the render cache against document-scoped ids leaking across documents.

- `componentHasRevision` now descends `props.columns[].header`,
  `props.columns[].cells[]` and any component nested in a cell's `content`, plus
  a row-parallel `props.rows[]`. Tables are cacheable, so without this a table
  carrying tracked changes would be served from the cross-document cache and
  replay dead `w:ins`/`w:del` ids into later documents.
- The cache-bypass ladder is extracted from `renderComponentWithCache` into a
  named, exported `componentBypassReason(component)` predicate so new bypass
  reasons are a new clause rather than a restructuring.
