---
'@json-to-office/core-docx': patch
---

Both DOCX renderers now write a line height set as a multiple in whole twips. A multiple was converted to 240ths without rounding, so `devportal`'s 1.02-line title came out as `<w:spacing w:line="244.8"/>` and the annual-report templates wrote values such as `277.68` and `266.40000000000003`, which OOXML does not allow; neither renderer rounds `w:line`. The compiler now rounds it to the nearest twip, and does the same for a theme's exact or at-least line height in points and for a tab stop, a paragraph frame's size and offsets, a statistic's spacing and the gap above a table-of-contents title stated with a fraction. LibreOffice renders the affected documents exactly as before.
