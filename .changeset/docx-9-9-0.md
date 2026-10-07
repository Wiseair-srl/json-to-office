---
'@json-to-office/core-docx': minor
'@json-to-office/json-to-docx': minor
'@json-to-office/shared-docx': minor
---

The default DOCX renderer (`docxjs`) now runs on docx 9.9.0 (from 9.8.1),
pinned exactly in `core-docx`, `json-to-docx` and `shared-docx`.

What changes in the files:

- A table of contents carries the page number of each entry. The pages are
  laid out at generation time with docx 9.9.0's `docx/layout`, as Word lays
  them out, so LibreOffice, PDF export and every reader that does not update
  fields show the numbers. When the layout reaches the end of the document
  without guessing, Word opens it without asking to update fields; when it
  guessed (a frame, a floating table, a font it has no measurements for), Word
  still asks and corrects the numbers. Entries link to their headings, a
  numbered heading keeps its number, and every entry takes its level's
  `TOC{n}` style. Only a document with a table of contents loads
  `docx/layout`; every other one renders exactly as before.
- When that layout fails, the table of contents is written without page
  numbers, Word asks to update fields as before, and generation reports
  `W_DOCX_PAGE_NUMBERS_UNAVAILABLE` instead of failing. docx 9.9.0's layout
  fails on any document with an empty header or footer.
- A section that ends on a text frame closes in a one-point paragraph after
  it, on every section rather than the document's last only. docx 9.9.0 writes
  a section's properties into its last paragraph, and in a framed one
  LibreOffice drew the frame at the top left of the page and moved every page
  after it (the annual-report templates).
- A table cell no style pads, such as one in a header or footer table, states
  Word's default cell margins instead of leaving them to the document's default
  table style.
- Everything else moves only in spelling: a `TableNormal` default table style,
  a section's properties in its last paragraph instead of an empty one after
  it, a width on each table cell that stated none, and a namespace on
  `comments.xml`. Pages draw as before in LibreOffice, but a page that opens a
  section on a paragraph with space before it sits up to 8pt lower (page 2 of
  the report-chrome blocks and the two block report templates). `office-open`
  output does not change.
