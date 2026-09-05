---
'@json-to-office/shared': minor
'@json-to-office/core-docx': minor
'@json-to-office/core-pptx': minor
---

`highcharts` output now inherits the document's typography (#354). The
theme's body family goes on the chart, the heading family on the title, the
`chartLabel` and `source` type roles (or a size one step under the body when
the theme declares none) on axes, legend, data labels and credits, and the
theme's text colours on all of them — beneath whatever the chart sets itself,
property by property, so an explicit author value keeps winning exactly as
`options.colors` does. Sizes are scaled to the width the image is placed at.
A registered non-safe theme family is inlined as `@font-face` from the
document's own font bytes ahead of any `resources.css`; a chart set in safe
fonts posts the same request it always did.
