---
'@json-to-office/core-docx': patch
---

A table in a section header or footer now takes `componentDefaults.table`, as a body table does: the theme's defaults, the document's `componentDefaults` over them, the table's own props over both. Header and footer tables used to skip the cascade and render with bare Normal Table cells, so a theme's `hideBorders`, `cellDefaults` (alignment, padding, fill, font), `headerCellDefaults`, border colour and size never reached them. Header and footer paragraphs and images are unchanged. A document with a table in a header or footer renders differently wherever its theme states table defaults.
