---
'@json-to-office/core-docx': minor
'@json-to-office/core-pptx': minor
'@json-to-office/shared': minor
---

The `office-open` renderers now run on `@office-open/docx` and
`@office-open/pptx` 0.14.6 (from 0.11.0), pinned exactly. 0.14 renamed most of
the option vocabulary; both adapters are migrated and typed against the
backends' own option types, so a renamed option fails the build instead of
dropping content.

What changes in the files:

- A native chart in a Word header or footer now opens in Word and draws in
  LibreOffice; with 0.11 the header pointed at no chart part (#485).
- On `office-open` pptx, a shape's outline takes its authored colour (it was
  dropped), and struck-through text is written as `sngStrike` (the invalid
  `single` made PowerPoint hang).
- An image a .docx draws at several sizes is one media part, not a marked
  copy per size.
- Everything else moves only in spelling: `off` for a false on/off value, no
  empty `docProps/custom.xml`, part, relationship and namespace order, chart
  booleans written `val="1"`, Office's own defaults no longer repeated in pptx
  masters, slides and view properties. Pages draw as before in Word,
  PowerPoint and LibreOffice. `docxjs` and `pptxgenjs` output does not change.

Charts are now built from options (`chartLook` in
`@json-to-office/shared/rendering`, replacing `spliceChartXml`) rather than
spliced into the emitted part, and on docx the backend embeds the chart
workbook itself.

Each `office-open` renderer refuses to load when another `@office-open`
version is installed, with an error named `RendererBackendVersionError` that
names both versions: the options are data, and a different version can drop
content without an error.
