---
'@json-to-office/shared-docx': minor
'@json-to-office/core-docx': minor
---

Add a native `chart` component for DOCX, drawn by the `office-open` renderer.

A real Word chart part with its own embedded workbook: recipients can restyle it
with Word's chart tools and open its numbers with **Edit Data**, it stays crisp
at any zoom, and it needs no export server — so unlike `highcharts` it also
works in the browser. Props mirror the pptx `chart` component (`type`, `data`,
`title`, `showLegend`, `chartColors`) with the flow placement `image` and
`highcharts` already use; slide coordinates are rejected rather than ignored.

`bubble` is not among the types: `@office-open` spells a bubble series as
x/y/size triples rather than categories and values, and handing it the latter
throws from inside its own bundle. It is refused by the schema and again at
compile time.

`docxjs` has no chart primitive at all, so it declines the new `charts`
capability and a document using the component fails with a named capability
error instead of losing the figure. The component is absent from that renderer's
schema branch entirely, so editors never offer it there.

`@office-open/docx` forwards only eight `ChartSpaceOptions` fields from a chart
run, which leaves the chart with no `c:externalData`, no series colours and no
axis titles — "Edit Data" fails and every series ignores the theme. Those parts
are spliced into the package after generation, and the workbook is built here
because nothing in `@office-open/core` writes one.
