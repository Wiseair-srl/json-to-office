---
'@json-to-office/core-docx': minor
'@json-to-office/mcp-server': minor
'@json-to-office/jto': minor
---

A DOCX `statistic` paints in the theme's type roles (#454): on a theme with roles the figure takes the `stat` role's size, face, weight and colour (`small`/`large` a step of the theme scale either side) and the unit, trend and caption the `label` size; themes without roles keep the built-in sizes. The consulting `stat` role is now 22pt regular in the accent, so the house kpi-row reads lighter, and the `client-report` size ceiling comes down from 11 to 9, measured on 155 client reports.
