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

`pptxgenjs` declares all ten; it already forwards every one of those props, so
no deck that renders today stops rendering. `office-open` declares none of them
yet and each moves into its set as the XML mapping lands. Until then a deck that
styled an office-open chart is refused before any bytes exist, instead of
shipping a chart that says something the author did not write.
