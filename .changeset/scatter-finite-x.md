---
'@json-to-office/core-docx': patch
---

Reject scatter x labels outside the finite number range before rendering. Both DOCX backends now report the chart and series instead of failing inside docx.js or plotting the point at zero.
