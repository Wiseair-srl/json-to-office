---
'@json-to-office/core-docx': patch
---

Fix floating-image `wp:docPr` renumbering when `id` is not the first attribute.

The renumbering pass matched `<wp:docPr id="…"` only, so it silently became a
no-op if docx ever emitted the attributes in a different order — every floating
image would keep `id="1"` and Word would prompt to repair the file, with the
whole test suite still green. The match now anchors on the element name and
finds `id` wherever it sits, preserving attribute order. Adds
`floating-docpr-uniqueness.test.ts`, which asserts docPr id uniqueness for a
generated document — the invariant no test covered before.
