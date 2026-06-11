---
'@json-to-office/core-docx': patch
---

fix(docx): built-in minimal/modern themes used "SF Mono" for the mono font,
which is not a SAFE_FONTS entry — every render logged FONT_UNRESOLVED and fell
back to a host font. Switched to Menlo (safe, closest match) so built-in
themes render warning-free out of the box.
