---
'@json-to-office/shared': patch
'@json-to-office/core-docx': patch
'@json-to-office/core-pptx': patch
---

Two defects the client-report checkpoint baseline surfaced. A DOCX section no longer ends in a bare paragraph holding its bookmark end: the anchors ride inside the section's first and last paragraphs (a one-point paragraph only beside a table), so a section whose last page is full no longer spills an empty page carrying only the running head and footer. Highcharts charts in both formats are rendered with `credits.enabled: false` beneath the author's options, so the `highcharts.com` credit never lands in a document's plot area unless the author enables it.
