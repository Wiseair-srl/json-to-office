---
'@json-to-office/core-docx': patch
---

DOCX generation is now deterministic for documents containing hyperlinks

docx.js numbers most relationships `rId1`, `rId2`, … but mints ids for external
hyperlinks from `Math.random`. Packaging normalised timestamps and ZIP headers
but not those ids, so **any document containing a link produced different bytes
on every render** — which defeated the point of `deterministic` generation and
made a linked document impossible to pin with a content hash.

Packaging now canonicalises volatile relationship ids to the conventional
`rIdN` form, numbering them by first appearance in the part that references
them. Documents with no volatile ids are byte-identical to before.

This is generic package finalisation — a property of an OOXML package rather
than of any one backend — so it applies regardless of which renderer produced
the file.
