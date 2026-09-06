---
'@json-to-office/shared': minor
'@json-to-office/core-docx': minor
'@json-to-office/jto': minor
'@json-to-office/mcp-server': minor
---

Three more DOCX report blocks as JSON definitions in the `client-report-blocks` playground template, on the shared contract: `kpi-row` (two to four `statistic` metrics with unit, signed delta and direction glyph, over a sourced hairline; replaces the `metric-row` example), `callout` (a label over up to sixty words of text, set off by one hairline on the left, no fill) and `data-table` (a title, a label column, one to six data columns right-aligned by construction, notes and a source line; 24 rows keep it on one page with its header), sharing a `source-line` definition with `kpi-row`. Every size and colour binds to a theme role with a safe default, so the three render warning-clean on every bundled theme; `jto://blocks` lists them.

`$if`, `$each` and `$count` now take an operand: a slot pointer as before, or one reference — `{ "$item": "/cells" }`, `{ "$slot": ... }`, `{ "$context": ... }` — so a repeat can walk the current item's own array and a condition can test one of its fields. A repeated element maps back to the item that produced it, and a DOCX table-design finding on a column a block compiled lands on that column's slot and offers no patch against nodes the author never wrote.
