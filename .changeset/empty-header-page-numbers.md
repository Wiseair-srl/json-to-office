---
'@json-to-office/core-docx': patch
---

A table of contents keeps its page numbers in a document where a section empties its header or footer. A section that states no header or footer after one that had them, or an explicit `header: []`, was written as a header with no paragraph at all, which Word never writes and on which docx's layout throws, so the contents field came out without numbers (`W_DOCX_PAGE_NUMBERS_UNAVAILABLE`, "elements.filter is not a function"). Such a header or footer is now written as one empty paragraph in the `Header` or `Footer` style, as Word writes it, on both renderers; the page lays out as before.
