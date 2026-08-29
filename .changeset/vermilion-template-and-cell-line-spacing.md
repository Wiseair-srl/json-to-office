---
'@json-to-office/jto': minor
'@json-to-office/core-docx': minor
'@json-to-office/shared-docx': minor
---

New `vermilion-annual-report` gallery template — a 16-page A4 annual report
(SVG page art, page-anchored floating text, real financial tables) with
bundled Clash Display fonts declared through `fontRegistry` file sources — and
a new bundled `vermilion` theme (poster-red / ink / creams). All runnable
`examples/` and the shipped `proposal` and `technical-guide` templates are
restyled onto it.

Table cells also gain `font.lineSpacing` (single / atLeast / exactly / double
/ multiple), carried end to end — `exactly` pins the line height for dense rows —
with an agreement test pinning that validate and generate accept the same
documents.
