---
'@json-to-office/quality': minor
'@json-to-office/core-docx': minor
'@json-to-office/core-pptx': minor
---

Adds information-design rules for charts and tables in both formats (#346).

The baseline runs said what holds documents back, and it was not integrity: across the 25 briefs that shipped in neither condition, the judges kept returning to charts and tables with no units, no sources and no takeaways. `table` appears 117 times in those verdicts, `chart` 53. Ten new codes cover that ground, written once in `@json-to-office/quality` and translated by each format, so a slide chart, a document chart and a Highcharts config are judged by one standard rather than three.

Charts: `W_QUALITY_CHART_3D` (a perspective projection distorts the comparison the chart exists for), `W_QUALITY_CHART_OVERLOADED` (past six slices or four series), `W_QUALITY_CHART_AXIS_BASELINE` (a bar axis off zero — only where the chart encodes with length, since zooming a line's axis is standard practice), `W_QUALITY_CHART_SERIES_COLORS` (the renderer's default palette belongs to no document; the fix names one theme token per series), `W_QUALITY_CHART_UNITS` and `W_QUALITY_CHART_ANNOTATION`, both advisory. The last is asked only of a chart that has somewhere to put the answer — a DOCX `caption`, a Highcharts `caption.text` — never of a native slide chart, which carries no such slot.

Tables: `W_QUALITY_TABLE_NUMERIC_ALIGN` (digits line up by place value only when flush right; the fix right-aligns the column, header included), `W_QUALITY_TABLE_MIXED_DECIMALS`, `W_QUALITY_TABLE_GRID` and `W_QUALITY_TABLE_ROW_COUNT`. A column counts as numeric when at least two body cells parse as numbers and nothing else in it is text; blanks, dashes and `n/a` are gaps rather than text, and number parsing is positional rather than locale-aware, since `1.234` is one thousand two hundred and thirty-four in Milan and one-point-two-three-four in Chicago.

Two decisions are worth stating because they are what keeps the rules quiet on documents that are already right. Alignment is read through each format's own cascade rather than off the cell, so a table that sets the alignment once for every cell in it is not reported as if every cell were silent. And the grid question is asked of the table's own declaration, not of the resolved borders: Word's baseline is a box around every cell and every PPTX theme draws a rule between them, so a resolved-border test would report every table that never mentioned its borders — one finding per table for a decision the theme took once, for the whole document.

The eight reference stock templates stay warning-clean. A new `quality-fixes` suite applies every emitted patch to a private copy of its document, re-analyzes, and asserts the finding is gone and no new warning took its place — a fix that leaves its own finding standing turns a repair loop into a loop.
