# PPTX Design Patterns & Best Practices

## Standard slides come from blocks

Prefer the reference blocks below for standard slides: copy the definition you use into `props.blocks` verbatim, then invoke it. Define a new block yourself for any layout used more than once (a cover, a statement, a two-column comparison, a metric row): percentage frames, type-role bindings with defaults, and `$if` around every optional slot. Use a code plugin only for programmable behavior — calculations, external data, layouts that depend on logic JSON cannot express — never for a layout blocks can describe.

Coordinate-authored slides (components directly in `slide.children`) are for genuinely unique, unrepeatable slides. If you have more than one such slide with the same shape, define a block instead.

## Reference blocks

These definitions come from complete playground templates and validate as they are. Copy the definitions you invoke (and any block a definition itself invokes) into `props.blocks`; the names are not built into the engine.

{{referenceBlocks}}

## Complete minimal example

```json
{
  "name": "pptx",
  "props": {
    "title": "Quarterly update",
    "theme": "consulting",
    "slideWidth": 13.333,
    "slideHeight": 7.5,
    "blocks": {
      "cover": {
        "description": "Title slide: eyebrow, title, subtitle over an accent rule.",
        "slots": {
          "eyebrow": { "type": "string", "maxWords": 8, "oneLine": true },
          "title": { "type": "string", "required": true, "maxWords": 16, "role": "actionTitle" },
          "subtitle": { "type": "string", "maxWords": 16 }
        },
        "body": [
          {
            "name": "shape",
            "props": {
              "type": "line",
              "x": "3.75%", "y": "31%", "w": "15%", "h": 0,
              "line": { "color": "accent", "width": 3 }
            }
          },
          {
            "$if": "/eyebrow",
            "then": {
              "name": "text",
              "props": {
                "text": { "$slot": "/eyebrow" },
                "style": "eyebrow",
                "fontSize": { "$theme": "/styles/eyebrow/fontSize", "default": 10 },
                "x": "3.75%", "y": "34%", "w": "90%", "h": "5%"
              }
            }
          },
          {
            "name": "text",
            "props": {
              "text": { "$slot": "/title" },
              "style": "title",
              "x": "3.75%", "y": "40%", "w": "82%", "h": "23%",
              "valign": "top",
              "fit": { "maxLines": 2, "shrink": [28, 24] }
            }
          },
          {
            "$if": "/subtitle",
            "then": {
              "name": "text",
              "props": {
                "text": { "$slot": "/subtitle" },
                "style": "subtitle",
                "x": "3.75%", "y": "64%", "w": "82%", "h": "7%"
              }
            }
          }
        ]
      }
    }
  },
  "children": [
    {
      "name": "slide",
      "props": { "meta": { "title": "Cover" } },
      "children": [
        {
          "name": "block",
          "props": {
            "ref": "cover",
            "slots": {
              "eyebrow": "Engineering · Q1 2026",
              "title": "Search v2 shipped; auth rewrite lands next quarter",
              "subtitle": "Quarterly engineering update"
            }
          }
        }
      ]
    },
    {
      "name": "slide",
      "props": { "meta": { "title": "Highlights" } },
      "children": [
        {
          "name": "text",
          "props": { "text": "Highlights", "style": "heading1", "x": 0.5, "y": 0.45, "w": 12.333, "h": 0.9 }
        },
        {
          "name": "table",
          "props": {
            "rows": [["Feature", "Status"], ["Search v2", "Shipped"], ["Auth rewrite", "In progress"]],
            "x": 0.5, "y": 1.6, "w": 12.333, "h": 1.5,
            "rowH": 0.45,
            "margin": [3, 6, 3, 6],
            "fontSize": 12,
            "border": { "type": "solid", "pt": 0.5, "color": "rule" }
          }
        }
      ]
    }
  ]
}
```

## Common layout pitfalls

### Text overflow
PPTX does not auto-shrink text outside a block. Inside a block, give titles a `fit` with declared `shrink` sizes; outside, keep headings short (≤ 6 words) or reduce `fontSize`. Give headings full width unless the layout genuinely needs a narrower column.

### Page numbers and chrome
Put page numbers, trackers and confidentiality footers in the block definitions (a text component with `{PAGE_NUMBER}` in the body) so every slide that invokes the block gets them in the same place — never overlapping content. A block's `slide.background` gives every invoking slide the same background.

### Element overlap
Multiple text or shape components in the same region render on top of each other. Give each element its own grid row or `y` offset (≥ 0.35" gap between a title and the label under it). Inside a block, use a `group` with `direction` to distribute items rather than hand-placing each.

### Circles vs stretched ellipses
An `ellipse` renders as a circle **only** when `w === h`. For avatars, badges and step indicators set equal `w` and `h`; explicit dimensions override grid sizing.

### Text inside small shapes
Keep text on a single line (`"PB"`, not `"P\nB"`), set `"align": "center"` and `"valign": "middle"`, and keep fontSize ≤ shape width in inches × 40.

## Table best practices

### Row heights & margins
Always specify `rowH` (0.4–0.55") and `margin` (`[3, 6, 3, 6]`). Without them rows expand unpredictably.

### Rounded corners
`borderRadius` (e.g. `0.15`) draws a `roundRect` behind the table; set outer borders to `"none"` and keep internal borders only. It requires explicit numeric `x`/`y` (inches).

### Unicode symbols
PowerPoint may render ✓✔✗✘ as emoji; use `fontFace: "Arial"` on cells with Unicode symbols (✓, —, •).

### Example: polished comparison table
```json
{
  "name": "table",
  "props": {
    "rows": [
      [
        { "text": "Feature", "bold": true, "fill": "primary", "color": "FFFFFF" },
        { "text": "Basic", "bold": true, "fill": "primary", "color": "FFFFFF", "align": "center" },
        { "text": "Pro", "bold": true, "fill": "primary", "color": "FFFFFF", "align": "center" }
      ],
      [
        { "text": "Storage" },
        { "text": "5 GB", "align": "center" },
        { "text": "100 GB", "align": "center" }
      ],
      [
        { "text": "Support" },
        { "text": "—", "align": "center", "fontFace": "Arial" },
        { "text": "✓", "align": "center", "fontFace": "Arial", "color": "22C55E" }
      ]
    ],
    "rowH": 0.45,
    "margin": [3, 6, 3, 6],
    "borderRadius": 0.15,
    "border": { "type": "solid", "pt": 0.5, "color": "E2E8F0" },
    "fontSize": 12,
    "x": 1, "y": 2, "w": 11.333, "h": 1.5
  }
}
```

## PPTX rendering limitations & workarounds

### Character spacing (`charSpacing`)
`charSpacing` (points) controls tracking on text and shape components: wordmarks `3`–`6`, uppercase labels `1`–`3`, body text omit.

### Font weight
Only `bold: true/false`, not numeric weights. For light text use font family variants in `fontFace` (`"Inter Light"`, `"Helvetica Neue Light"`).

### Text opacity
Not supported. Pre-compute muted hex colors (white at ~50% on dark → `"808080"`, ~35% → `"595959"`) or use the theme's `text2`.

### Decorative elements
SVGs are not supported as shapes. Use `ellipse` for dots, `rect` and `line` for dividers, pre-rendered PNG (base64) for complex decorations.

### Multi-element cards / rich text in shapes
For metric cards with per-segment formatting, use **rich text segments** in a single shape:
```json
{
  "name": "shape",
  "props": {
    "type": "roundRect",
    "fill": { "color": "background2" },
    "align": "center",
    "valign": "middle",
    "text": [
      { "text": "124K", "fontSize": 36, "bold": true, "color": "primary" },
      { "text": "Active users", "fontSize": 12, "color": "text2", "breakLine": true },
      { "text": "▲ 34% YoY", "fontSize": 11, "color": "positive", "breakLine": true }
    ],
    "x": "0%", "y": "0%", "w": "100%", "h": "100%"
  }
}
```
Each segment can have its own `fontSize`, `fontFace`, `color`, `bold`, `italic`, `breakLine`, `spaceBefore` and `spaceAfter`. Inside a block, wrap such cards in a `group` with `"direction": "row"` and an `$each` over an array slot so two to four cards distribute themselves.
