---
'@json-to-office/core-docx': minor
'@json-to-office/shared-docx': minor
'@json-to-office/json-to-docx': minor
---

feat(docx): bump docx to 9.7.0; auto-populate TOC, surface table look + paragraph indent

- Bump `docx` peer/dep from 9.5.1 to 9.7.0 across core-docx, shared-docx, and json-to-docx (plus pnpm override).
- TOC: cached entries are now auto-populated from the document's headings during the structure pass. Word displays the TOC body immediately on open instead of the "right-click to update field" placeholder, and (with `beginDirty` defaulting to false) the macOS "update fields?" popup no longer fires. JSON authors only set `beginDirty: true` if they want Word to prompt for a refresh on open.
- Table: add `tableLook` block (`firstRow`, `lastRow`, `firstColumn`, `lastColumn`, `bandedRows`, `bandedColumns`) for Word's conditional table formatting. Internally inverted to docx's `noHBand`/`noVBand`.
- Paragraph: add `indent` block (`left`, `right`, `firstLine`, `hanging`, `firstLineChars`). `firstLine` and `hanging` are mutually exclusive (schema-enforced via union). `firstLineChars` is the CJK-friendly char-grid companion to `firstLine`.

All new fields are optional — no breaking changes to existing `.docx.json` documents.
