---
'@json-to-office/core-docx': patch
---

A hyperlink inside a table cell no longer damages the document

A markdown link in a table cell emitted an `r:id` that `word/_rels/document.xml.rels`
never declared — a dangling relationship, which **Word reports as a damaged file**.
Only the first document generated in a process was correct; every one after it was
broken, so a long-running server produced them almost exclusively. The same link in
an ordinary paragraph was always fine.

Tables go through the cross-document component cache and paragraphs do not, which is
the whole difference. docx.js registers an external hyperlink by mutating the rendered
tree at pack time: it swaps each `ExternalHyperlink` for a concrete one carrying a
freshly minted id and declares that id on the document being packed. A cached table
handed to the next document arrived already concrete, so nothing was registered and
the id it emitted belonged to a document that had been written and closed.

Components carrying an external link now skip that cache, the way revision- and
comment-bearing components already do. Internal `#anchor` links reference a bookmark
directly, cost no relationship, and stay cacheable.
