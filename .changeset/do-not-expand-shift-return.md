---
'@json-to-office/core-docx': patch
---

A line that ends in a manual line break no longer stretches across a justified paragraph in Word. A `\n` in a paragraph's text is written as a line break inside the paragraph, and Word by default spreads the line before one over the full width when the paragraph is justified, so a two-word line ran from margin to margin, as in any report whose theme justifies body text. Every document now sets Word's `doNotExpandShiftReturn` compatibility option in `word/settings.xml`, on both renderers, so that line is set like the last line of a paragraph. There is no option to turn it off: Word's default is never what a generated document wants. Nothing else in the files changes.
