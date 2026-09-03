---
'@json-to-office/quality': minor
'@json-to-office/core-docx': minor
'@json-to-office/core-pptx': minor
---

Three brand and integrity rules: box overlap in PPTX, font-family count and palette adherence in both formats.

`box-overlap` reports two opaque boxes on one slide that land on each other. Opacity carries the whole claim — an image, a chart, a table or a filled rectangle paints its entire box, so two of them intersecting really do hide each other. A _text_ box supports no such claim, and measuring against the reference decks is what settled it: every candidate finding over text was a legitimate design — an 80pt title whose generous box swallows a 12pt label beside it, a value centred in the hole of a donut chart, a corner badge inside the declared frame of a two-line heading. Text-on-text needs the ink, not the box, and belongs to the rendered pass. Transparency disqualifies a fill and only `rect`/`roundRect` count, because the decks stack tinted discs and pie wedges whose bounding boxes cross by design and whose ink never does.

Intersecting is not the same as wrong, so the verdict is split. Two opaque boxes crossing is `info` — an accent strip along the top of a card, a badge over a photograph, both of which the reference decks do deliberately. Two cases are warnings, because neither is ever a design: a box whose geometry matches another to within two points is a leftover duplicate, and anything covering a chart or a table covers data. A box fully inside a larger one is layering and is not reported; two equal rectangles are the duplicate case and are.

`font-count` counts the families a document can paint — the theme's `heading` and `body` plus every family named in the document — and warns past three. `mono` and `light` are excluded: they paint nothing until a component asks for them, and counting an unused `Courier New` flagged a report that uses a single typeface.

`palette-adherence` reports a colour written as a literal that the resolved theme, overrides included, does not define, and emits an RFC 6902 fix naming the nearest token. Nearest is the "redmean" approximation, which ranks near-neighbours roughly as an eye does; ties break on token name so a document always emits the same fix. It is `info` because an off-palette colour is often deliberate — a client's brand red inside an otherwise on-theme report — and the finding exists to make the choice visible. A colour is recognised by where it sits, so a hex inside a sentence stays prose.

Across the eight reference stock templates the three rules produce no unexplained warnings. The one that remains is true and now recorded: `standard-annual-report` really does carry four font families.
