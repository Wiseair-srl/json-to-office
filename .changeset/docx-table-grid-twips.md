---
'@json-to-office/core-docx': patch
---

A DOCX table whose columns state no width now writes its column grid in twips, sized to the width the table stands in (the section's text column less any gutter, or for a table in a text box the box less its padding), instead of writing each column's percentage as a width. Google Docs, Apple Pages and QuickLook lay a table out from its grid and drew such a table a character per column; Word and LibreOffice render it as before. A text box drawn as a table gets the same grid in place of a 100-twip placeholder column.
