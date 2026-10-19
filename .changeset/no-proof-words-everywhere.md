---
'@json-to-office/core-docx': patch
---

The words a document accepts through `noProofWords`, on the theme or on the document's props, are now marked `w:noProof` wherever they appear, not only in paragraphs and headings. Table cells (header cells and tables in headers and footers included), list items, image, visual and chart captions, tracked changes (inserted, deleted and unchanged text), the text of a native visual's text elements and shapes, a statistic's description, a table of contents title and footnote, endnote and comment bodies used to skip the list, so Word underlined an accepted word such as a product name as soon as it sat in a table cell. A paragraph inside a cell, or a paragraph whose text is a markdown list, also adds its own `noProofWords`, as any paragraph does. Nothing else in the files changes: the accepted words become runs of their own, with the same text and formatting, and in a tracked change each such run is a change of its own with its own id.
