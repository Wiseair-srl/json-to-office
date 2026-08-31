---
'@json-to-office/core-docx': minor
'@json-to-office/shared-docx': minor
'@json-to-office/mcp-server': patch
---

New `rule` component: a horizontal rule, the thin line a brand system draws
between sections. Follow-up to #291, whose closing note this implements — the
route that issue caught (an 8pt paragraph with a 1pt exact line box, wanted as
a 3pt rule) existed because nothing else drew a line: `font.size` floors at
8pt, `paragraph` has no border, and the alternatives were a `visual`, a
bordered `text-box` or a one-row table.

```json
{
  "name": "rule",
  "props": { "thickness": 3, "color": "accent", "width": "40%" }
}
```

`thickness` (points, 0.25–12), `color` (hex or theme token, default the theme's
`border`), `style` (solid/dashed/dotted/double), `width` (points or `"NN%"`,
default the full measure), `alignment`, `spacing` (default 6pt either side).

It compiles to what Word itself draws: an empty paragraph wearing a `w:pBdr`
bottom border, so the result stays a real Word object rather than a picture of
a line. The paragraph's own line box is collapsed to 1pt — the same
construction #291 reports when it is hand-rolled on a paragraph carrying text,
correct here because there are no glyphs to clip, and done once in the compiler
so nobody has to reach for it. A partial `width` becomes paragraph indents,
resolved against the theme page like `image`'s percentage widths; the default
full-measure rule states no indent at all and is therefore exact wherever it
lands.

`W_QUALITY_LINE_BOX_COLLAPSE` now names the component in its suggestion, which
is the point: that finding is usually someone drawing a line, not setting
leading.

Both renderers emit it, from the same IR, byte-identically — `borders` leaves
the list of features the compiler could only declare and joins the capability
set both adapters prove with a test. `docxjs` gained paragraph-border emission
to get there; it had the IR field and dropped it. The empty-paragraph spacer
idiom is untouched: that draws a gap, not a rule.
