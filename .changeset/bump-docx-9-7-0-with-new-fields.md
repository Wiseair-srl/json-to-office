---
'@json-to-office/core-docx': minor
'@json-to-office/shared-docx': minor
'@json-to-office/json-to-docx': minor
---

feat(docx): bump docx to 9.7.0; surface TOC cached entries, table look, and paragraph indent

- Bump `docx` peer/dep from 9.5.1 to 9.7.0 across core-docx, shared-docx, and json-to-docx (plus pnpm override).
- TOC: add `cachedEntries` + `beginDirty` props. When `cachedEntries` are supplied, Word displays the TOC immediately on open instead of the "right-click to update field" placeholder.
- Table: add `tableLook` block (`firstRow`, `lastRow`, `firstColumn`, `lastColumn`, `bandedRows`, `bandedColumns`) for Word's conditional table formatting. Internally inverted to docx's `noHBand`/`noVBand`.
- Paragraph: add `indent` block (`left`, `right`, `firstLine`, `hanging`, `firstLineChars`). `firstLineChars` is the CJK-friendly char-grid companion to `firstLine`.

All new fields are optional — no breaking changes to existing `.docx.json` documents.
