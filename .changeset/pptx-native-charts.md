---
'@json-to-office/shared': minor
'@json-to-office/shared-pptx': minor
'@json-to-office/core-pptx': minor
'@json-to-office/core-docx': patch
---

The pptx `office-open` renderer draws native charts.

It used to refuse them, for a specific reason: `@office-open` writes chart XML
whose `<c:f>` references are empty and ships no workbook behind them, so the
chart drew and **Edit Data** failed. A chart you cannot edit is not the chart
that was asked for. The adapter now writes that missing half itself, the same
way the docx side does, so both pptx backends produce an editable native chart
and the `chart` component is no longer pruned from the `office-open` schema
branch.

The repairs are now shared between the two formats — a `c:chartSpace` is
DrawingML and reads the same in a .docx and a .pptx — and live in
`@json-to-office/shared/rendering`. Each core keeps its own packaging, because
`core-docx` zips with adm-zip and `core-pptx` with jszip; the shared module
deals only in strings and adds no dependency.

The two backends omit **different amounts** of a chart, so every repair is
guarded on what the XML actually lacks: `@office-open/pptx` keeps the legend
position where `@office-open/docx` loses it. Everything else — the cell
references, the series colours, the axis titles, the bar grouping and
`c:externalData` — is missing from both and written by the same pass.

Three of those repairs are shape-dependent. A pie or doughnut is coloured per
data point, so one `c:dPt` is written per slice; a series fill would paint every
slice the same colour. A scatter chart has no category axis — both of its axes
are `c:valAx` — so its axis titles are placed by position rather than by tag.
And bar grouping has no `ChartSpaceOptions` field at all, so a `stacked` or
`percentStacked` chart used to come out as side-by-side bars that sum to
nothing.

Two details are load-bearing rather than cosmetic:

- The embedded workbook is named `Microsoft_Excel_Worksheet{N}.xlsx`, matching
  pptxgenjs, because `canonicalizeChartIds` renumbers that exact token — and the
  splice therefore has to run before finalization, not after.
- Axis titles are spliced into the backend's own axes rather than passed as
  `axes`. Supplying that option replaces the default axis pair wholesale and
  requires ids the adapter cannot allocate; doing so emitted literal
  `<undefined>` elements, which LibreOffice tolerates and PowerPoint offers to
  repair.

A ragged chart — series of differing lengths, which the pptx compiler accepts
and the docx one refuses — now writes only the cells it actually has. Padding
the rectangle put a data point in the workbook the author never wrote and
claimed a cell range longer than the cached values behind it.

One chart type stays `pptxgenjs`-only: `bubble`. `@office-open` spells a bubble
series as x/y/size triples rather than categories and values, and no reading of
a category label as a numeric x is unambiguous, so it is refused by name at
validation rather than guessed at or crashed into.

`isPptxComponentSupported` is removed from `@json-to-office/shared-pptx`; it was
internal, and with charts supported it returned true unconditionally.
