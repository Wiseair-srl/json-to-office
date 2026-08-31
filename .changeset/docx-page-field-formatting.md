---
'@json-to-office/core-docx': patch
---

A `{PAGE}` or `{TOTAL_PAGES}` field now keeps its formatting in LibreOffice, and
therefore in the PDF path and `jto_preview`. docx.js packs `begin`, `instrText`,
`separate` and `end` into a single `w:r`; Word reads that, LibreOffice does not
— it computes the number itself and paints it with the document default, so the
`Page {PAGE}` running header both shipped templates use rendered "Page" at 8pt
grey and the numeral at 11pt black. The `docxjs` adapter now writes one run per
field character, each repeating the same `rPr`, which is also the shape Word
itself writes.

Measured rather than reasoned: six XML shapes were rendered through
`soffice --convert-to pdf` and the glyphs' font, size and colour read back out.
Splitting the runs fixes it with or without a cached result; a cached result
inside the single run does **not**, nor does a `w:fldSimple` carrying a fully
formatted cached run — LibreOffice recomputes and discards that run's
properties. `<w:pgNum/>`, which would inherit `rPr` for free, renders as
nothing at all.

No cached result is written between `separate` and `end`. Nothing in this
pipeline paginates, so the only value available would be a fabricated one —
right on page 1 and wrong on every page after it in any reader that shows the
cached result instead of recomputing. That is the opposite call from the TOC
field, which does ship cached entries: there the cached text is the real
heading text, known at generation time. A page number is not.

Every corpus golden containing a page field moved, and only those — 11 cases,
including both shipped templates. A field still loses its formatting on the
experimental `office-open` backend, which writes every field as a bare
`<w:fldSimple/>` with no run properties at all; that gap is recorded in
`docs/architecture/office-renderer-ir.md` rather than fixed.
