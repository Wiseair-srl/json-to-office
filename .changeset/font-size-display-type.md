---
'@json-to-office/shared-docx': minor
---

fix(docx): raise the `font.size` cap from 72pt to the format's real limit

`font.size` was capped at 72pt, which rejected valid display type — cover numerals, chapter headings, pull quotes. The cap had no basis in the format: OOXML stores font size in `w:sz` as half-points (`ST_HpsMeasure`, an unsigned measurement with no 72pt ceiling), and Word's own UI accepts up to 1638pt. The maximum is now 1638; the `minimum: 8` sanity floor is unchanged.

The renderer never clamped — `w:sz` is emitted as `size * 2` at every conversion site — so documents that set a size above 72 already produced correct output; only the schema disagreed. A 163pt heading now validates and round-trips to `<w:sz w:val="326"/>`.

`TextFormattingPropertiesSchema` is spread into the component font schema and both theme style schemas, so the new range applies uniformly to `props.font`, `theme.styles.*` and `theme.styles.TOC1..6`.

**Note on when this surfaced.** The 72pt cap dates back to the initial scaffold and was never changed. What changed is validation _coverage_: before 0.19.1 the CLI validator only walked the root's direct children and one level of `section` children, so an over-cap size nested deeper — inside a `text-box`, a `columns` child, a table cell, or a custom component's emitted output — was silently accepted. 0.19.1 made the walk whole-tree, which is why documents that validated under 0.17.x can fail on 0.19.1+ with `Expected number to be less or equal to 72` while their shipped `.docx` was always structurally fine. See `docs/migration-0.19.md`.
