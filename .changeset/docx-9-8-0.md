---
'@json-to-office/core-docx': minor
'@json-to-office/json-to-docx': minor
'@json-to-office/shared-docx': minor
---

Bump the `docx` rendering backend from 9.7.1 to 9.8.0. The pin stays exact in
`pnpm.overrides` and in every peer/dependency declaration, so consumers of
`@json-to-office/json-to-docx` install `docx@9.8.0`.

Package-level consequences, verified part by part against the full corpus, the
gallery templates and the examples (the `office-open` backend is unchanged):

- Every document carries docx's stock `word/theme/theme1.xml`, and a document
  with no comments no longer carries an empty `word/comments.xml`.
  Relationship ids shift around both.
- `styles.xml` no longer repeats docx's own `Title` and `Heading1`–`6` ahead of
  the theme's under the same ids, and `Normal` is marked as the default
  paragraph style.
- Schema fixes upstream: `w:tentative` and the level `w:pStyle` position in
  numbering, percentage table widths in fiftieths, `w:shd w:val="clear"`,
  `w:tblOverlap` outside `w:tblpPr`, `off` for a false row flag, and a tight
  wrap that keeps its side and its wrap polygon.
- Drawing ids (`wp:docPr`) are unique across the whole package, headers and
  footers included, and the same on every build.

docx now depends on nanoid 6, whose `engines` field reads Node
`^22 || ^24 || >=26`: on Node 23 or 25 the install prints an engines warning.
LibreOffice renders every gallery template unchanged; the two contract examples'
signature tables sit 1pt higher.
