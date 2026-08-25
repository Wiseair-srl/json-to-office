---
'@json-to-office/core-docx': minor
'@json-to-office/shared-docx': patch
---

The DOCX `statistic` renders the props it has always accepted, and defines the
styles it has always named.

`unit`, `size`, `trend` and `trendValue` were declared, accepted by the schema,
reported clean by validation and generation, and read by nothing:
`{ "number": "99", "unit": "%" }` produced `99`. The shipped `docx-report` starter
used `unit: "%"`, so an agent copying it — which is what starters are for — lost
the percent sign with no diagnostic anywhere in the pipeline.

- `unit` renders as a suffix run at half the figure's size, with no separator, so
  `"99"` + `"%"` reads as one value. Write the space into the prop if you want one.
- `size` sets the figure to 20/28/40pt for small/medium/large. `medium` states
  nothing on the run and takes it from the style.
- `trend` renders `▲`/`▼`/`–` — a glyph, not a colour, because the palette has no
  semantic success/danger slot and down is not bad for churn — with `trendValue`
  beside it in the muted text colour.
- `format` remains unimplemented; "number format pattern" names no dialect. It now
  warns (`W_STATISTIC_FORMAT_IGNORED`) instead of vanishing.

The two paragraphs also carried `StatisticNumber` and `StatisticDescription`,
style ids that nothing in the codebase defined. An undefined `w:pStyle` is not an
error in OOXML — it resolves to Normal — so the component built for KPIs rendered
at body size and weight, and a heading plus a paragraph gave a better result than
the purpose-built component. Both styles are now generated from the theme: the
figure at 28pt in the heading font on the primary colour, `keepNext` so it never
splits from its caption; the caption at 10pt in the muted text colour. A theme
that names either id under `styles` still wins.

Only documents that contain a statistic get the styles, so no other output moved.
