---
'@json-to-office/core-docx': minor
'@json-to-office/shared-docx': minor
'@json-to-office/jto-ops': patch
---

The docx `chart` component draws on the default docx.js renderer (docx 9.8
`ChartRun`), with an embedded workbook and the theme's palette and fonts;
`renderer: "office-open"` is no longer needed. Both renderers now refuse a
multi-series pie, negative pie/doughnut values, empty series, non-numeric
values and a chart with no room, and warn on scatter labels that are not
numbers and on axis titles for pies. Embedded workbooks in a .docx are
normalized for byte-identical output.
