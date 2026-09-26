---
'@json-to-office/core-docx': patch
---

The `office-open` DOCX renderer no longer writes Word's own defaults where the document states none. Every section carried the 15.6pt line grid of Word's Chinese template, so body text was laid out on it and came out spaced differently from the default renderer, and `styles.xml` carried Word 365's document defaults (theme fonts, kerning, ligatures, en-US/zh-CN/ar-SA, 8pt after and 1.16 lines). Both are now stated as the default renderer writes them: no document grid and empty document defaults, so body text no longer drifts line by line between the two renderers.
