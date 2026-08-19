---
'@json-to-office/core-docx': minor
'@json-to-office/shared-docx': minor
---

Add `between` to the theme border schema.

A style's `borders` now accepts `between` alongside `top`/`bottom`/`left`/
`right`, mapping to OOXML `w:between` — the rule Word draws between consecutive
paragraphs that share the border set, in place of their adjoining bottom and top
edges. Same shape as the per-side definitions, including theme colour tokens.

This is the theme border schema only; the paragraph component has no `border`
prop and this does not add one.

Needs docx 9.7.1: `IBordersOptions.between` does not exist in 9.5.1.
