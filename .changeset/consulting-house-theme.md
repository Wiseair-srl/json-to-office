---
'@json-to-office/core-docx': minor
---

New bundled DOCX theme `consulting` (#329, DOCX portion): the house style
for client and technical reports — near-black ink, three greys and one
deep-blue accent, Calibri body under Arial headings, Consolas for code,
hairline rules and no fills behind body text, safe fonts only. The first
theme to carry every shared visual layer: the full type-role ladder from a
10.5pt base at ratio 1.2, `palette` roles with a blue-and-grey chart series,
an 8pt spacing base, and chrome and motif recipes for the blocks to paint
from. Opt in with `props.theme: "consulting"`; `minimal` stays the default
until the house theme exists in both formats. The theme paints and requires
nothing — trackers, sources and footers stay a blueprint or profile's call.
