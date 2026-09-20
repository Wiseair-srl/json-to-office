---
'@json-to-office/core-docx': patch
'@json-to-office/jto': patch
'@json-to-office/mcp-server': patch
---

A DOCX section that changes the paper size or orientation now starts on a new page, as Word already did and LibreOffice did not, and warns `W_SECTION_PAGE_BREAK_FORCED` when it was set to continue. Tables, images, charts, columns and shapes inside a section with its own page are sized to that section's text width instead of the theme's, and the office-open backend writes table widths as whole twips.

The shipped `client-report-blocks` example no longer switches its third section to Letter paper mid-document — a house client report stays on one paper size — so the report is three A4 pages again. Per-section page overrides keep working; they are covered by tests rather than by the example.
