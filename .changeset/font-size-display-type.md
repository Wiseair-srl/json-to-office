---
'@json-to-office/shared-docx': minor
---

fix(docx): raise the `font.size` cap from 120pt to the format's real limit

The cap had no basis in the format. OOXML stores font size in `w:sz` as half-points (`ST_HpsMeasure`, an unsigned measurement with no low ceiling), and Word's own UI accepts up to 1638pt. Successive caps — 72pt originally, 120pt since `font.scale` landed — still rejected valid display type: cover numerals, chapter headings, pull quotes. The maximum is now 1638; the `minimum: 8` sanity floor is unchanged.

The renderer never clamped — `w:sz` is emitted as `size * 2` at every conversion site — so documents that set a size above the cap already produced correct output; only the schema disagreed. A 163pt heading now validates and round-trips to `<w:sz w:val="326"/>`.

`TextFormattingPropertiesSchema` is spread into the component font schema and both theme style schemas, so the new range applies uniformly to `props.font`, `theme.styles.*` and `theme.styles.TOC1..6`.
