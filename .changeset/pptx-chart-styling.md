---
'@json-to-office/core-pptx': minor
---

Chart styling is now a capability a pptx renderer either has or refuses.

`charts` said a backend could draw a chart from data. It said nothing about
whether that backend honoured the options the chart was _styled_ with, and the
office-open renderer read almost none of them: it accepted a chart, drew it, and
quietly dropped the data labels, the axis bounds, the grid lines, the fonts and
the bar, line, pie and radar tuning. An ignored `valAxisMaxVal` draws a
different chart from the authored one and nothing in the file says so.

Ten finer capabilities now sit beside `charts` — `chart-data-labels`,
`chart-data-border`, `chart-axis-scale`, `chart-axis-visibility`,
`chart-axis-style`, `chart-bar-style`, `chart-line-style`, `chart-pie-style`,
`chart-radar-style` and `chart-text-style`. The compiler requires one **only
when the matching prop was authored**, at that prop's own path, so a refusal
names the line to change rather than the chart.

Keyed off the authored props rather than the compiled IR deliberately:
`compileChartLabelFont` falls back to the theme body font when a weight is
authored without a face, so a compiled font object can hold a family the author
never wrote — asking the IR "was a font set here?" would demand
`chart-text-style` of a chart that only styled its weight.

Three are implemented so far — `chart-bar-style`, `chart-pie-style` and
`chart-data-labels` — by forwarding `gapWidth`, `overlap`, `holeSize`,
`firstSliceAngle` and per-series `dataLabels` to the backend.

Data labels write every flag explicitly, and that is not tidiness. A DrawingML
`CT_Boolean` has an optional `val` that defaults to **true**, so
`<c:dLbls><c:showVal/></c:dLbls>` does not mean "show the value" — it means show
the value, the category name, the series name, the percentage and the legend
key, because every flag left out defaults to on. A chart authored with
`showValue: true` came out labelled `Q1; Revenue; 120`.

The three axis capabilities — `chart-axis-scale`, `chart-axis-visibility` and
`chart-axis-style` — follow, and these are the ones that could misrepresent
data: an ignored `valAxisMaxVal` rescales a chart without saying so.

They are spliced rather than passed, because `AxisOptions` cannot be handed to
`@office-open` at all. The axis is rebuilt rather than patched: CT_CatAx and
CT_ValAx fix the order of their children — `majorGridlines` before `title`
before `numFmt` before `spPr` before `txPr`, all between `axPos` and `crossAx` —
and inserting each edit at its own anchor put whichever landed last in front of
the others, which a reader offers to repair rather than draws wrong.

Then `chart-line-style`, `chart-data-border` and `chart-radar-style`. The
series marker and `smooth` pass through; the other three have nowhere in the
backend to go. `ChartSeriesCommon` carries no line width, so `lineSize` is
spliced into `c:ser/c:spPr/a:ln`; `dataBorder` becomes an outline in the same
place — or on each `c:dPt` of a pie, which is coloured per slice — without
displacing the fill. `c:radarStyle` is written from a literal `standard`, so
`marker` and `filled` had nowhere to go and became `standard` without a word.

`lineSize` and `dataBorder` reach the same `a:ln` and never at the same time:
one is the width of a series that _is_ a line, the other an outline on a series
that is a filled shape. Checked against pptxgenjs rather than assumed — given
both, it writes the border on a bar chart and `lineSize` on a line chart.

Last, `chart-text-style`: `a:defRPr` spliced into the chart title's runs, the
legend's existing `c:txPr`, every series' `c:dLbls`, and each axis. An axis
rotation and an axis font land in _one_ `c:txPr` — they are two properties of
the same text, and a second one is a repair prompt rather than a
differently-styled label.

With that the gap is closed: office-open declares all ten, and nothing a chart
can be styled with is accepted-and-dropped any more.

`pptxgenjs` declares all ten; it already forwards every one of those props, so
no deck that renders today stops rendering. `office-open` now declares all ten too. The capability split remains the
contract: a prop is honoured or refused by name, never accepted and dropped.
