---
'@json-to-office/shared-docx': minor
'@json-to-office/core-docx': minor
'@json-to-office/mcp-server': minor
---

Three DOCX blocks give a report its architecture, styled from the theme's chrome recipes: `cover` (title, subtitle, client, date, confidentiality, logo — put it in a section of its own), `section-opener` (number as an eyebrow, title as a level-1 heading, and the tracker label the running head shows) and `running-head` (header with document title and section tracker, footer with confidentiality, page `n / N` and date). A running head is declared once and fills its section and every later one that authors no chrome; each section's opener changes the tracker; authored `header`/`footer` always win. Every slot is one line by schema and word-budgeted by `W_QUALITY_SLOT_BUDGET`; generated chrome maps back to the slot that produced it; a `running-head` anywhere but directly under a top-level section is a validation error (`invalid_placement`), and a cover logo must name exactly one source.

The header/footer compile path now honours a paragraph's `themeStyle`, `tabStops`, `indent` and `characterSpacing` (the `practice-note` example's running head gains the tracking it authored). Run properties stay explicit on every run so LibreOffice paints page fields in the role's face.
