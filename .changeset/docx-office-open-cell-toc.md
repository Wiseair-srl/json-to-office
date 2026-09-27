---
'@json-to-office/core-docx': patch
---

A table of contents inside a table cell — a `text-box` rendered as a table, or `columns` inside one — is now written by the `office-open` DOCX renderer, as it is by the default renderer. `@office-open/docx` writes nothing but paragraphs and tables in a cell, so the field vanished without a warning and left its title above an empty box. Its entries now go into the cell and the field is put around them once the package is written: the same content control the backend writes for a table of contents in the body.
