---
'@json-to-office/core-docx': patch
---

Collapse the duplicated `PAGE_SIZES` table into one source of truth.

`core/layout.ts` carried an inline copy of the A4/A3/Letter/Legal twip
dimensions alongside the one in `styles/utils/layoutUtils.ts`, so the two could
drift. `getPageDimensions` and `PAGE_SIZES` are now exported from the styles
barrel and the inline copy is gone. Also corrects two comments that labelled
A4's 11906x16838 as "Letter size".
