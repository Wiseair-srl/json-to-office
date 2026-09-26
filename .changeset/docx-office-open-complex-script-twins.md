---
'@json-to-office/core-docx': patch
---

The `office-open` DOCX renderer now writes the complex-script twin of every run size, bold and italic it states — `w:szCs`, `w:bCs` and `w:iCs` beside `w:sz`, `w:b` and `w:i` — in runs, numbering levels, styles and document defaults, as the default renderer does. Arabic, Hebrew and other complex-script text took the document default's size, weight and slant on `office-open` alone (in LibreOffice, 12pt regular under a 21pt bold heading); it now matches the default renderer.
