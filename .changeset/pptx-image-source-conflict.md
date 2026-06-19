---
'@json-to-office/core-pptx': patch
'@json-to-office/shared-pptx': patch
---

fix(pptx): reject images that set more than one source (path/base64/svg)

`path`, `base64`, and `svg` are mutually exclusive on the image component, but all three are optional fields on one object schema — so a multi-source payload passed the structural check and was silently resolved by runtime precedence. PPTX now collects these conflicts in an unconditional tree walk (`collectImageSourceConflicts`, mirroring core-docx) and fails generation with a `mutually_exclusive` error pointing at the offending component anywhere in the tree (slides, grids, containers, table cells). This brings pptx to full parity with docx, where the same conflict is already a hard error.
