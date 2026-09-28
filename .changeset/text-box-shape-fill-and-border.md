---
'@json-to-office/core-docx': minor
---

A `text-box` rendered as a shape draws both a fill and a border when it is given
both. On docx 9.7.1 the two came out in an order Word rejects, so the border
was dropped with a warning; docx 9.8.0 writes them in schema order, and the
warning is gone.
