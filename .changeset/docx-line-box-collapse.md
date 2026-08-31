---
'@json-to-office/core-docx': minor
'@json-to-office/shared-docx': minor
'@json-to-office/quality': minor
---

New `docx/line-box` rule (`W_QUALITY_LINE_BOX_COLLAPSE`): an `exactly` line box
shorter than the capitals of the text it holds. `font.size` is floored at 8pt
because smaller type cannot be read, but the box the glyphs sit in had no guard
at all, so `{ "type": "exactly", "value": 1 }` on 8pt type validated clean and
rendered as a smear of overlapping lines (#291).

The guard is relative rather than a schema floor, because an absolute floor
would be wrong: an empty spacer paragraph legitimately pins 2pt, and the stock
templates draw thin gaps that way. It fires only on `exactly` — `atLeast` and
the multiples can never be shorter than the text needs — only where there is
text to clip, and only below 0.7 em, which is cap height on the faces the stock
templates use and below every legitimate value in the reference corpus (whose
tightest exact box is 10pt on 12pt type). The repair grows the box to one em,
not to the floor: rendered at 8pt, stacked lines still touch at the floor and
are clean at one em. Sizes resolve through `componentDefaults` and the
paragraph style — its own size, else the theme font it names — so a collapsed
box is caught whether or not the component states its own size.

`lineSpacing.type` and `lineSpacing.value` also gained the descriptions they
never had — which unit each rule reads, and why `value` has no floor.
