---
'@json-to-office/core-docx': patch
---

The `office-open` DOCX renderer now writes lengths in twips as whole numbers, floored the way the default renderer floors them. A theme's tracking is a share of an em times the size, so the `consulting` eyebrow's came out as `<w:spacing w:val="12.8"/>`, which OOXML does not allow, and LibreOffice set the client report's eyebrow and running head wider than the default renderer does. Tracking, indents, cell widths and margins, row heights, a floating table's offsets and the page's size, margins and columns now match the default renderer's integers, and the client report renders the same on both.
