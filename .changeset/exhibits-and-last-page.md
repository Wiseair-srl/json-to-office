---
'@json-to-office/quality': patch
'@json-to-office/core-docx': minor
'@json-to-office/jto-ops': patch
'@json-to-office/jto': patch
---

A new docx rule, `docx/exhibit-required` (`W_QUALITY_EXHIBIT_MISSING`, off by default), reports a document with fewer charts or tables of two or more columns than `minimumExhibits`; the `client-report` profile enables it at one, and the blueprint's narrative variant now scaffolds a data table in its analysis section so a fresh scaffold satisfies it. `rendered/page-underfilled` now also judges the last page, at a quarter instead of half, so a stub page holding only the notes and sources is reported (`context.kind` is `middle-page` or `last-page`).
