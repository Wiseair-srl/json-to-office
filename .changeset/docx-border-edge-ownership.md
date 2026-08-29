---
'@json-to-office/core-docx': minor
'@json-to-office/shared': patch
'@json-to-office/shared-docx': patch
---

Table border sides you name now always render, identically everywhere. A side
named in a per-side `borderColor`/`borderSize` object on a cell or its column
survives `hideBorders` (which now only silences inherited table-level borders)
and owns its shared edge: the compiler adjudicates every interior edge — a
named side beats an inherited one, equals fall to ECMA-376 §17.4.66's weight
rules — and writes the winner on both cells, so Word and LibreOffice stop
resolving the same file differently. Previously a cell's red divider could
render in Word but vanish from the LibreOffice-rendered PDF preview, and
templates had to state both halves of every internal edge to compensate.
Scalar `borderColor`/`borderSize` on a cell remain restyling knobs that claim
no side.

Also fixes `mergeWithDefaults` destroying an object-form table-level
`borderColor`/`borderSize` when the theme's `componentDefaults.table` states a
scalar for the same key — the string was spread into `{0:'#',1:'f',…}` and the
author's per-side object silently vanished.
