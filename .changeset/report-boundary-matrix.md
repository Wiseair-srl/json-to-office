---
'@json-to-office/core-docx': minor
'@json-to-office/jto-ops': minor
'@json-to-office/mcp-server': patch
'@json-to-office/jto': patch
---

Block boundary matrix (#343, report portion): every JSON block the client-report template embeds, at the edges of its slot schema on every bundled DOCX theme, in design and fallback fonts, on A4 and Letter, held warning-clean by the static rules and by the rendered pass through LibreOffice. The matrix found and this release fixes a `columns` table rendering at half the measure after any paragraph (a nested `columns` no longer makes its section multi-column, and the table now carries its grid), and tightens the report block budgets the layout could not hold: running-head title 6 words and tracker 3, section-opener tracker 3, cover title 12 and subtitle 20 words with their own line spacing, KPI value 7 and unit 5 characters with the figures a size smaller at four, data-table columns 1–5 with headers of 14 and cells of 10 characters, rows that never split and the block's own cell padding. Scaffold markers are no longer measured against slot budgets or choices, by the one predicate `@json-to-office/quality` exports (`isScaffoldMarker`), and the playground editor schema agrees. design-evals gains `--set` and the committed `client-report-checkpoint` brief set for #360. The rendered pass now reads a page in geometric order — a table row cell by cell, a rotated axis title as poppler gave it — so a wrapped cell maps on every poppler version, not only the one that already emits cells whole.
