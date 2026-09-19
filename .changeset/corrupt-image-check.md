---
'@json-to-office/shared': patch
'@json-to-office/core-docx': patch
'@json-to-office/core-pptx': patch
'@json-to-office/jto-ops': patch
---

A PNG or JPEG whose bytes would not decode (bad chunk CRCs, pixel data that does not inflate, a missing end marker) now fails generation as `ASSET_UNREADABLE` naming the image, instead of shipping a document that Word and PowerPoint open with "The picture can't be displayed". The block matrix's own test image, which was one such file, is now a valid PNG.
