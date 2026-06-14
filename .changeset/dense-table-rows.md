---
'@json-to-office/core-docx': minor
'@json-to-office/json-to-docx': minor
'@json-to-office/jto-cli': minor
'@json-to-office/jto': minor
---

fix(docx): table rows no longer inherit body-paragraph spacing

Table cells render as a single wrapper paragraph that previously inherited the
theme's `normal` style, dragging body-prose rhythm (8–10pt after-spacing +
1.4–1.5× line) into every row. That inflated row height by ~9pt regardless of
font size, cell padding, or the cell `height` prop (which is `atLeast`, so it
can only grow rows). A 5pt-font row still rendered ~22pt tall.

Table cells (and header cells) now get their own dense paragraph spacing by
default — no extra before/after spacing, single line. Vertical breathing room
is the job of cell padding. Measured row pitch for a single-line 11pt row drops
from ~28.9pt to ~13.7pt.

Themes can tune table spacing via two new conventional style keys (standard
`StyleProperties`, no schema change):

- `styles.tableCell` — paragraph spacing/line for body cells
- `styles.tableHeader` — paragraph spacing/line for header cells

```json
{
  "styles": {
    "tableCell": {
      "spacing": { "after": 6 },
      "lineSpacing": { "type": "multiple", "value": 1.5 }
    }
  }
}
```

Note: this changes the rendered height of existing tables (rows become tighter).
Documents relying on the old roomier rows can restore them per-theme via
`styles.tableCell` / `styles.tableHeader`.
