---
'@json-to-office/core-docx': minor
---

`theme1.xml` now carries the jto theme's name, ten scheme colours and
heading/body fonts on both renderers, so Word's Design tab, colour and font
menus offer the document's palette. Pages do not change, except a native
chart's lines, which follow the theme's Text 1 on both renderers: its gridlines
and axis lines on `docxjs`, which take a tint of Text 1 as Word's own charts
do, and its axis lines and tick marks on `office-open`, which state no colour.
