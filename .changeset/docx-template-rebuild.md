---
'@json-to-office/core-docx': minor
---

Rebuild the two shipped DOCX templates, and split them across two themes.

`proposal` and `technical-guide` were re-authored from scratch with the
`vermilion-annual-report` stock template as the reference — its display-heading
scale, its hairline tables with a single accent rule and a flush-left first
column, its muted body colour and tinted emphasis rows, its KPI figures, and a
full-bleed cover and back cover. Both gained a running header and footer, a
designed contents page, and diagrams sized to render at readable type.

The two then split by house style, because a pair of examples that look alike
demonstrates half as much. `proposal` keeps `vermilion`; `technical-guide` moved
to the bundled `devportal` theme — cool slate, one teal accent, monospace where
the reader is expected to type — which until now no shipped document used. The
composition rules carried over unchanged; the dressing did not: a monospaced
section index, headings set solid over the theme's own accent rule, table
headers as a shaded band rather than a vertical rule, and code in a closed
fence. `devportal`'s margins give a 487.3pt measure against `vermilion`'s
477.3pt, so every fixed column width and page break was re-checked.

One structural change is worth copying: a numbered part of a document is no
longer its own Word `section`. A section exists to change page setup or chrome,
these parts change neither, and a section ends with the empty paragraph that
carries its break — which produced a blank page whenever a part happened to fill
its last page. Both documents now use three sections (cover, body, back cover)
and put `pageBreak` on each part's opening paragraph instead.
