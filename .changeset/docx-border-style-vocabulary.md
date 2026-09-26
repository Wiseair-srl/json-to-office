---
'@json-to-office/core-docx': patch
---

A `text-box` border authored `solid` now draws on the `office-open` backend.

A component authors its border the CSS way — `solid`, `dashed`, `dotted`, `double`, `none` — and a border's `w:val` does not: OOXML spells a plain line `single`. The compiler passed the authored word into the IR; docx.js drew the word it did not know as `single`, and `office-open` wrote `w:val="solid"`, which LibreOffice draws as no border at all. The compiler now translates the word, every border reaches the IR in OOXML's vocabulary, and IR validation rejects any other.

docx.js no longer draws a theme border style outside the six it mapped as `single`: a theme's `wave`, `triple` or `thickThinSmallGap` rule now renders as stated, as it already did on `office-open`. A theme handed over as an object (`customThemes`) whose border style is outside that vocabulary draws `single` on both backends.
