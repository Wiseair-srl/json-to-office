---
'@json-to-office/core-docx': minor
'@json-to-office/json-to-docx': minor
---

`resolveHighchartsOptions({ options, theme, width?, height?, documentProps?, page?, fonts? })` returns the effective options of a `highcharts` node: exactly the `infile` the render posts to the export server. The theme goes through what generation does to it before any chart is drawn — the document's `themeOverrides`, the design system's type roles, the font export mode, the document's `componentDefaults`, the section's `page` — and then the request is built: the theme's `componentDefaults.highcharts.options` beneath the node's own, the theme's chart palette when the node sets no `colors`, and the document's type scaled to the width the chart is placed at. `resolveHighchartsRequest` returns the whole request body, `resources` with any `@font-face` rules included. Both are pure, and both run the render's own functions rather than a copy of them, so they cannot drift from what was drawn.
