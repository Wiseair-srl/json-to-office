---
'@json-to-office/core-pptx': minor
'@json-to-office/shared': minor
---

A named PPTX text style now carries a place on the slide, and a table looks like a
table before anyone styles one.

**Named styles land in a band.** `title`, `subtitle`, `heading1`–`3`, `body` and
`caption` described type and nothing else, while every text box that stated no
`x`/`y` resolved to (0, 0). A slide with a `title` and a `subtitle` therefore drew
both blocks on top of each other in the top-left corner — the exact shape of the
shipped `pptx-deck` starter. Each style now has a default band expressed as
fractions of the slide extent, so it holds at any aspect ratio. Each axis is
decided on its own, so a stated `x` still wins for `x`, and a text box with no
`style` keeps the origin it has always had.

Two positionless boxes can still share a band — two of the same style — so that
case is reported as `TEXT_OVERLAP_UNPOSITIONED` rather than silently drawn.
Moving one of them is a layout engine's job and belongs with the coordinate-free
layout work, not with a default.

**Tables get a border and a header row.** No bundled theme defined
`componentDefaults.table`, so a table rendered as bare text in columns: no rule
between cells, nothing marking the first row. The themes now state a border, and
`headerRow` — a new optional prop on the PPTX table — defaults on through them. It
is a compile-time treatment of row 0, so nothing new reaches either renderer, and
every part of it yields to something the author said: a cell's own `fill`, `bold`
or `color`, or a table-wide `fill`, `color` or `fontWeight`. A stated
`fontWeight` aliases the family to a real sub-family rather than setting `bold`,
so the header leaves the weight alone there — otherwise an explicit `400` would
be overruled, and a Light table would get a header synthesised bolder than the
body under it.

No `margin` default: cell insets are a capability the `office-open` renderer
refuses, and a theme default every table inherited would have turned a working
backend into one that fails every table.

The two table components are also described honestly for the first time. The DOCX
table is column-major (`columns[]`, each with its own `header` and `cells[]`); the
PPTX table is row-major (`rows[][]`, no structural header). Both descriptions now
say which they are and name the other, so an agent that has just written one does
not get the other wrong on the first try.
