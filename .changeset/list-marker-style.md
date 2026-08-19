---
'@json-to-office/core-docx': minor
'@json-to-office/shared-docx': minor
---

Add per-level marker styling to lists.

A list level now accepts a `font` (`family`, `size`, `color`, `bold`, `italic`,
`underline`) that maps to the numbering level's own run properties, so the
number or bullet glyph can carry a font, size, weight or colour independent of
the list text. `color` accepts a hex value or a theme colour token like every
other colour in the schema. This was the one thing about list markers that was
previously inexpressible: numbering only ever emitted paragraph indentation.

Levels without a `font` emit exactly the XML they did before.
