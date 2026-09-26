---
'@json-to-office/core-docx': patch
---

A style's italic now reaches the document on the default DOCX renderer. The docx.js adapter passed it under a key docx.js does not read, so every style's `italic`, `true` or `false`, was dropped from `styles.xml` while the `office-open` renderer wrote it: a Heading 5 on the `minimal`, `consulting` and `vermilion` themes drew upright on one renderer and italic on the other. The style now states `w:i` with its complex-script twin `w:iCs`, as a run already did.
