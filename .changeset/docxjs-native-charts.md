---
'@json-to-office/core-docx': minor
'@json-to-office/shared-docx': minor
'@json-to-office/shared': minor
'@json-to-office/jto-ops': patch
---

The docx `chart` component draws on the default docx.js renderer (docx 9.8
`ChartRun`), with an embedded workbook and the theme's palette and fonts;
`renderer: "office-open"` is no longer needed. Both renderers now refuse a
multi-series pie, negative pie/doughnut values, empty series, non-numeric
values and a chart with no room, and warn on scatter labels that are not
numbers and on axis titles for pies. Embedded workbooks in a .docx are
normalized for byte-identical output.

`office-open` charts now draw in the same Word Insert Chart look as docx.js:
light gridlines and axis lines in a tint of the theme's Text 1, no tick marks,
Word's bar gaps, straight 2.25pt lines with round markers, slice borders in
Background 1 and a doughnut with a hole. This also fixes four office-open
defects: line charts drawn as curves, a doughnut with no hole, scatter x values
plotted at 1, 2, 3… (they are now numbers, in the chart and its workbook), and
an untitled chart given a title from its series' name. The shared chart splice
takes the matching opt-in edits (axis position, ticks and line, theme-colour
gridlines, bar gaps, pie angle, hole size, marker outline, numeric scatter x),
which pptx does not use, so pptx output does not change.
