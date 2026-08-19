---
'@json-to-office/core-docx': patch
---

Render tracked changes on paragraphs inside table cells.

`processCellContent` read only `props.text`, so a cell paragraph carrying a
`revision` rendered as plain text — the tracked change was dropped with no error
or warning, even though the schema accepts `revision` on paragraphs wherever
they appear. Cell paragraphs now take the same revision-aware path `createText`
uses and emit `w:ins` / `w:del` inside `w:tc`. Header cells too.
