# DOCX prop cheat-sheet

Curated reference for the most-used DOCX component props. For exhaustive coverage consult `assets/schemas/document.schema.json`, but **never read it whole** — it's >2MB. Grep it for a specific prop:

```bash
grep -A 5 '"keepNext"' assets/schemas/document.schema.json | head -20
```

## Units

| Concept                           | Unit                                  |
| --------------------------------- | ------------------------------------- |
| Page margin, floating offset      | **twips** (1 inch = 1440 twips)       |
| Font size, `spacing.before/after` | **points**                            |
| Table column width                | **points**                            |
| Image `width` (number)            | points; or percentage string `"100%"` |
| Page width A4 / Letter            | 11906 twips / 12240 twips             |
| Text-box internal padding         | ~90 twips per side                    |

Estimating text-box height in twips:
`height ≈ fontSize_pt × 20 × lineCount + spacingAfter_pt × 20`

## Document root

```json
{
  "name": "docx",
  "props": {
    "metadata": { "title": "Q2 Report", "author": "Name" },
    "theme": "minimal",
    "componentDefaults": {
      /* optional */
    }
  },
  "children": [
    /* only `section` components allowed at root */
  ]
}
```

Only `section` is allowed as a direct child of `docx`. All visible content lives inside sections.

## Section

```json
{
  "name": "section",
  "props": {
    "page": {
      "size": "A4",
      "margins": { "top": 1440, "right": 1440, "bottom": 1440, "left": 1440 },
      "orientation": "portrait"
    },
    "header": [
      {
        "name": "paragraph",
        "props": {
          "text": "Company · Q2 2026",
          "alignment": "right",
          "font": { "size": 8, "color": "#646B8B" }
        }
      }
    ],
    "footer": [
      {
        "name": "paragraph",
        "props": {
          "text": "Confidential",
          "alignment": "left",
          "font": { "size": 8, "color": "#646B8B" }
        }
      }
    ]
  },
  "children": [
    /* heading | paragraph | image | visual | table | list | columns | statistic | toc | highcharts | text-box */
  ]
}
```

### Section rules

- **First section** defines `header` and `footer` explicitly as arrays.
- **Every subsequent section** uses `"header": "linkToPrevious"` and `"footer": "linkToPrevious"` unless intentionally changing them. Omitting these on a non-first section makes headers/footers disappear silently.
- `header` and `footer` accept the same component types as section children — **not** a `{ name: "header" }` wrapper.
- Dynamic page numbering isn't exposed via a prop; add the field in Word after rendering, or use static labels.
- Prefer section-level header/footer over floating text-boxes — they respect page margins.

## Content components

### `heading`

```json
{
  "name": "heading",
  "props": {
    "text": "Chapter Title",
    "level": 2,
    "pageBreak": true,
    "keepNext": true,
    "font": { "bold": true, "color": "primary" },
    "alignment": "left",
    "spacing": { "before": 24, "after": 12 }
  }
}
```

- `level`: 1–6.
- `pageBreak`: page-break **before** this heading.
- `keepNext`: prevents orphaning at page bottom. **Always `true` for h3 and below.**
- `spacing.before/after`: pt.

### `paragraph`

```json
{
  "name": "paragraph",
  "props": {
    "text": "Body with **bold**, *italic*, and ***bold italic***.",
    "font": {
      "size": 11,
      "color": "text",
      "lineSpacing": { "type": "exactly", "value": 18 }
    },
    "alignment": "justify",
    "spacing": { "after": 12 },
    "keepLines": true,
    "boldColor": "#4CAF50"
  }
}
```

- Markdown subset: `**bold**`, `*italic*`, `***bold italic***`, `\n`.
- `lineSpacing` goes **inside `font`**, never at paragraph level (silently ignored otherwise). Types: `single`, `double`, `multiple` (with `value`), `exactly` (pt), `atLeast` (pt).
- `characterSpacing` requires both fields: `{ "type": "expanded"|"condensed", "value": N }`. `{ "value": N }` alone fails validation.
- `boldColor`: color override for the `**bold**` runs only. Useful for `"**Revenue:** $1.2M"`.
- `keepNext` / `keepLines`: pagination control.
- `themeStyle`: applies a named theme style to a paragraph without making it a structural heading.
- **Top-level paragraphs do NOT support a `border` prop.** `border` is valid only inside a `text-box`. For a horizontal rule in body flow, use a single-row borderless table or a unicode box-draw line (`"text": "━━━…"`).

### `image`

```json
{
  "name": "image",
  "props": {
    "path": "https://example.com/img.jpg",
    "width": "100%",
    "widthRelativeTo": "page",
    "caption": "Figure 1",
    "alignment": "center",
    "spacing": { "after": 14 },
    "floating": {
      "behindDocument": true,
      "verticalPosition": { "relative": "page", "align": "center" },
      "horizontalPosition": { "relative": "page", "align": "center" }
    }
  }
}
```

- `width`: percentage string OR points.
- `widthRelativeTo`: `"page"` for full-bleed; `"margin"` (default) otherwise.
- `floating`: floats over/behind content. Essential for cover backgrounds.
- `path` accepts public URLs or absolute local paths.

### `visual` (free-canvas pptx graphic → embedded PNG)

For infographics, diagrams, hero compositions, layered/overlapping art — anything the docx flow layout can't express. You author a single **pptx canvas** plus its `elements`; the renderer rasterizes the canvas to a PNG and embeds it like an `image` (the component desugars to `image`). Requires a rasterization service — `render_preview.py` wires one automatically (see SKILL.md → "Rendering services").

```json
{
  "name": "visual",
  "props": {
    "canvas": {
      "width": 6.5,
      "height": 3.2,
      "background": { "color": "background" }
    },
    "elements": [
      {
        "name": "shape",
        "props": {
          "type": "rect",
          "x": 0,
          "y": 0,
          "w": 6.5,
          "h": 3.2,
          "fill": { "color": "primary" }
        }
      },
      {
        "name": "text",
        "props": {
          "text": "73%",
          "x": 0.4,
          "y": 0.8,
          "w": 3,
          "h": 1.4,
          "fontSize": 54,
          "color": "background",
          "bold": true
        }
      }
    ],
    "dpi": 200,
    "width": "100%",
    "alignment": "center",
    "caption": "Figure 1",
    "spacing": { "after": 14 }
  }
}
```

- **`canvas.width`/`height` are INCHES** — they set the aspect ratio and the default physical size of the embedded image. (Unlike the rest of DOCX, which uses twips/points.)
- **`elements` are PPTX slide-content** (`text`, `shape`, `image`, `table`, `chart`, `highcharts`) — author them exactly as in a `.pptx.json` slide; see `pptx-cheatsheet.md`.
- **Position elements absolutely with `x`/`y`/`w`/`h` in inches** (or `%`). The canvas declares **no grid** — don't use `grid` placement inside a `visual`.
- **Colors inside `elements` follow PPTX rules** (bare hex, no `#`); shape text uses `fontColor`, text uses `color`. Prefer theme names (`"primary"`, `"text"`) — they sidestep the #/no-# trap and stay themeable.
- **Placement props mirror `image`:** `width` (default = canvas physical size; override with `"80%"` or a pixel number), `height`, `alignment`, `caption`, `spacing`, `floating`, `alt`, `keepNext`, `keepLines`.
- **`dpi`:** raster resolution, default 200, range 36–600. Higher = sharper but larger.
- **When to use:** prefer `visual` over `image` when the graphic is data-driven/themeable (it swaps with the theme), and over `text-box` when shapes overlap or layer. For a plain external picture, use `image`.

### `table` (column-oriented)

DOCX tables are **column-oriented** (PPTX tables are row-oriented — opposite). Each column has a `header` and `cells` array.

```json
{
  "name": "table",
  "props": {
    "keepInOnePage": true,
    "repeatHeaderOnPageBreak": true,
    "headerCellDefaults": { "color": "#FFFFFF", "backgroundColor": "primary" },
    "cellDefaults": {
      "font": { "size": 9, "color": "text" },
      "padding": { "top": 6, "bottom": 6, "left": 8, "right": 8 },
      "horizontalAlignment": "right",
      "verticalAlignment": "top"
    },
    "columns": [
      {
        "width": 120,
        "cellDefaults": { "horizontalAlignment": "left" },
        "header": { "content": "Category" },
        "cells": [{ "content": "Revenue" }, { "content": "Growth" }]
      },
      {
        "width": 80,
        "header": { "content": "Q1" },
        "cells": [{ "content": "$1.2M" }, { "content": "+12%" }]
      }
    ]
  }
}
```

### Table critical rules

- **Column widths sum to ≤ available page width.** For A4 with 1440-twip margins (1 inch) on all sides: available = ~451 pt. Overshoot = silent right-edge spill.
- `color` on a cell = **text color**. For a filled cell (e.g. dark header bar) set `backgroundColor` for the fill, **and** `font.color` for the text.
- Solid header fills: put `backgroundColor` + `font.color` on **each column's `header` object** directly, not on `headerCellDefaults`. Column-level `cellDefaults` silently overrides `headerCellDefaults` and produces dark-text-on-dark-fill.
- Never put `rows` on a DOCX table. That's PPTX. Use `columns`.

### `list`

```json
{
  "name": "list",
  "props": {
    "type": "bullet",
    "items": ["First point.", "Second point with **bold**.", "Third point."],
    "font": { "size": 11 },
    "spacing": { "after": 6 }
  }
}
```

`type`: `"bullet"` or `"number"`. `items` accepts strings or nested objects.

### `columns` (multi-column layout)

```json
{
  "name": "columns",
  "props": {
    "columns": [
      {
        "width": "50%",
        "children": [
          /* components */
        ]
      },
      {
        "width": "50%",
        "children": [
          /* components */
        ]
      }
    ],
    "gutter": 24
  }
}
```

### `statistic` (KPI / big-number block)

```json
{
  "name": "statistic",
  "props": {
    "value": "3.2×",
    "label": "Faster shipping cadence",
    "font": { "size": 48, "color": "primary" }
  }
}
```

### `text-box` (floating positioned content)

Used for cover pages and floating callouts. Paragraphs inside a `text-box` **do** accept `border` (unlike top-level paragraphs).

```json
{
  "name": "text-box",
  "props": {
    "border": { "bottom": { "color": "primary", "size": 6 } },
    "verticalPosition": { "relative": "page", "offset": 2160 },
    "horizontalPosition": { "relative": "page", "offset": 1440 },
    "width": 5760
  },
  "children": [{ "name": "paragraph", "props": { "text": "Floating quote." } }]
}
```

Offsets are in twips. Text-boxes also add ~90 twips of internal padding per side — factor into height calculations.

### `toc` (table of contents)

```json
{
  "name": "toc",
  "props": {
    "title": "Contents",
    "depth": 3
  }
}
```

Generated from `heading` levels 1 through `depth`.

## Common prop confusions

| Concept                  | Right                  | Wrong                 |
| ------------------------ | ---------------------- | --------------------- |
| Cell text color          | `font.color`           | `color` (means fill)  |
| Cell fill                | `backgroundColor`      | `color`               |
| Paragraph line spacing   | inside `font`          | at paragraph root     |
| Hex prefix               | with `#` (DOCX)        | without (that's PPTX) |
| Table orientation        | `columns` (DOCX)       | `rows` (PPTX)         |
| Border on body paragraph | only inside `text-box` | top-level paragraph   |
| `characterSpacing`       | `{ type, value }`      | `{ value }` alone     |

## Color references

- Use theme keys (`"primary"`, `"text"`, `"textSecondary"`, `"accent"`) in document components.
- Raw hex (`"#1A2B5C"`) reserved for theme definition files.
- DOCX uses `#`; PPTX doesn't.

## Authoring checklist

Before validating:

- First section has explicit `header` + `footer`; subsequent sections `linkToPrevious`.
- `h3+` headings have `keepNext: true`.
- Table column widths sum within available page width.
- `font.lineSpacing` inside `font`, not at paragraph root.
- `characterSpacing` has both `type` and `value`.
- Cover-page paragraphs override `lineSpacing: single` and `spacing: { before: 0, after: 0 }`.
- No `border` on top-level paragraphs (use text-box or table or unicode rule).
- DOCX hex codes have `#`.
- Cell text uses `font.color`; cell fill uses `backgroundColor`.
- DOCX table uses `columns`, never `rows`.

Then `python3 <skill>/scripts/validate.py …`.
