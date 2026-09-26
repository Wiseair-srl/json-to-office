---
'@json-to-office/core-docx': patch
'@json-to-office/shared-docx': patch
---

An image, native visual, native chart or text-box shape inside a DOCX text box, or in a column of a multi-column section, is now sized against that box or column instead of the page: an image with no width fills the box instead of running past it, a percentage width is a share of the box, and a chart with no width takes the box's width. `widthRelativeTo: 'page'` still measures the page. A Highcharts chart is placed the same way but keeps a page-relative type scale, so in a narrow box its text comes out smaller.
