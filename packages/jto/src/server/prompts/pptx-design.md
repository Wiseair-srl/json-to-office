# PPTX Design Patterns & Best Practices

## Recommended Master Set

Always define at least these 2-3 masters:

1. **TITLE_MASTER** — full-bleed title slide. Placeholders: `title`, `subtitle`
2. **CONTENT_MASTER** — standard content slide with heading + body. Placeholders: `heading`, `body`
3. **TWO_COLUMN_MASTER** — heading + left/right columns. Placeholders: `heading`, `left`, `right`

## Custom Slides (no master) — AVOID

For one-off layouts, skip `master`/`placeholders` and use `children` directly. **If you have more than one custom slide, you almost certainly need another master instead.**

```json
{
  "name": "slide",
  "props": { "background": { "color": "primary" } },
  "children": [
    { "name": "text", "props": { "text": "Special Layout", "grid": { "column": 1, "row": 2, "columnSpan": 10 }, "fontSize": 36, "color": "FFFFFF", "align": "center" } }
  ]
}
```

Only use this for truly unique, unrepeatable slides. Prefer masters for any layout used more than once.

## Complete Minimal Example

```json
{
  "name": "pptx",
  "props": {
    "title": "Quarterly Update",
    "theme": "corporate",
    "masters": [
      {
        "name": "TITLE_MASTER",
        "background": { "color": "primary" },
        "objects": [
          { "name": "shape", "props": { "type": "rect", "x": 0, "y": 6.8, "w": 10, "h": 0.7, "fill": { "color": "secondary" } } }
        ],
        "placeholders": [
          { "name": "title", "type": "title", "style": "title", "grid": { "column": 1, "row": 1, "columnSpan": 10, "rowSpan": 2 }, "fontSize": 44, "color": "FFFFFF", "valign": "middle" },
          { "name": "subtitle", "type": "body", "style": "subtitle", "grid": { "column": 2, "row": 3, "columnSpan": 8 }, "color": "accent" }
        ]
      },
      {
        "name": "CONTENT_MASTER",
        "grid": { "margin": { "top": 1.1 } },
        "objects": [
          { "name": "shape", "props": { "type": "rect", "x": 0, "y": 0, "w": 10, "h": 0.9, "fill": { "color": "primary" } } },
          { "name": "text", "props": { "text": "COMPANY", "x": 0.6, "y": 0.15, "w": 4, "h": 0.6, "fontSize": 14, "bold": true, "color": "FFFFFF" } }
        ],
        "slideNumber": { "x": 9, "y": 6.85, "w": 0.5, "h": 0.5, "color": "text2", "fontSize": 8 },
        "placeholders": [
          { "name": "heading", "type": "title", "style": "heading1", "grid": { "column": 0, "row": 0, "columnSpan": 12 } },
          { "name": "body", "type": "body", "style": "body", "grid": { "column": 0, "row": 1, "columnSpan": 12, "rowSpan": 4 } }
        ]
      }
    ]
  },
  "children": [
    {
      "name": "slide",
      "props": {
        "master": "TITLE_MASTER",
        "placeholders": {
          "title": { "name": "text", "props": { "text": "Q1 2026 Update" } },
          "subtitle": { "name": "text", "props": { "text": "Engineering Division" } }
        }
      }
    },
    {
      "name": "slide",
      "props": {
        "master": "CONTENT_MASTER",
        "placeholders": {
          "heading": { "name": "text", "props": { "text": "Highlights" } },
          "body": { "name": "table", "props": { "rows": [["Feature", "Status"], ["Search v2", "Shipped"], ["Auth rewrite", "In Progress"]], "grid": { "column": 0, "row": 3, "columnSpan": 12, "rowSpan": 2 }, "fontSize": 12, "border": { "type": "solid", "pt": 0.5, "color": "E2E8F0" } } }
        }
      }
    }
  ]
}
```

## Common Layout Pitfalls

### Text overflow
PPTX does not auto-shrink text. If text is too long for its container it will clip or overflow.
- Keep heading text short (≤ 6 words) or reduce `fontSize` for longer headings
- Always give headings full width (`columnSpan: 12`) unless the layout genuinely needs a narrower column
- For long text, prefer a smaller `fontSize` over truncation

### Slide number placement
Never position `slideNumber` where it overlaps content. Safe defaults:
- Bottom-right corner: `{ "x": 9.2, "y": 7.0, "w": 0.5, "h": 0.3, "fontSize": 8 }`
- Ensure the heading placeholder's grid row does **not** share space with the slide number

### Element overlap
Multiple text or shape components in the same region will render on top of each other. Prevent this:
- Give each element its own grid row, or use explicit `y` offsets so they stack vertically
- When placing a label below a title (e.g. name + role), put the title in row N and the label in row N+1, or use different `y` values with enough gap (≥ 0.35")
- Never place two text components at the same `x`/`y` unless one is intentionally a background layer

### Circles vs stretched ellipses
An `ellipse` shape renders as a circle **only** when `w === h`. If `w ≠ h` it stretches.
- For avatar circles, badges, or step indicators: always set equal `w` and `h` (e.g. `"w": 0.6, "h": 0.6`)
- When using grid positioning for ellipses, ensure the grid cell is square. If not, use explicit `w`/`h` to force a 1:1 ratio — explicit dimensions override grid sizing.

### Text inside small shapes
When placing text inside a shape (initials, numbers, icons):
- Keep text on a single line — never use `\n` in initials or short labels (use `"PB"` not `"P\nB"`)
- Set `"align": "center"` and `"valign": "middle"` for proper centering
- Ensure fontSize is small enough to fit the shape (rule of thumb: fontSize ≤ shape width in inches × 40)

## Table Best Practices

### Row heights & margins
Always specify `rowH` for consistent, compact rows (recommended 0.4–0.55"). Always specify `margin` for cell padding (recommended `[3, 6, 3, 6]`). Without these, rows expand unpredictably.

### Rounded corners
Use `borderRadius` (e.g. `0.15`) for polished rounded-corner tables. This renders a `roundRect` shape behind the table. When using `borderRadius`, set outer borders to `"none"` and keep internal borders only. **`borderRadius` requires explicit numeric `x`/`y` (inches, not `%` or grid-only)** — if the table is grid-positioned without explicit `x`/`y`, rounded corners are silently skipped.

### Unicode symbols
PowerPoint may render ✓✔✗✘ as color emoji. The renderer auto-appends a text variation selector to force text rendering. For best results, use `fontFace: "Arial"` on cells with Unicode symbols (✓, —, •) since Arial has reliable glyph coverage.

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
    "grid": { "column": 1, "row": 2, "columnSpan": 10, "rowSpan": 3 }
  }
}
```

## PPTX Rendering Limitations & Workarounds

### Character spacing (`charSpacing`)
Use `charSpacing` (number, in points) on text and shape components to control letter-spacing/tracking.
- Wordmarks/logos: `"charSpacing": 3` to `6`
- Uppercase labels/section identifiers: `"charSpacing": 1` to `3`
- Normal body text: omit (0 default)

### Font weight
pptxgenjs only supports `bold: true/false`, not CSS font-weight values (300/400/500/600/700). To achieve light/thin text, use font family variants in `fontFace`:
- `"Inter Light"`, `"Inter Thin"`, `"Helvetica Neue Light"`, `"Montserrat Light"`
- Use light font variants for elegant/refined designs rather than relying on bold alone.

### Text opacity
PPTX text doesn't support opacity. To achieve semi-transparent text effects, pre-compute muted hex colors:
- White at ~50% on dark bg → `"808080"`
- White at ~35% on dark bg → `"595959"`
- For secondary/tertiary text on dark backgrounds, use muted hex colors rather than expecting opacity support.

### Decorative elements
SVGs are not supported. For decorative elements:
- Use `ellipse` shapes for dot patterns
- Use `rect` shapes for dividers/bars
- Use pre-rendered PNG images (base64) for complex decorations

### Multi-element cards / Rich text in shapes
For metric cards with per-segment formatting (large number, small label, colored indicator), use **rich text segments** in a single shape instead of overlaying multiple elements:
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
      { "text": "Active Users", "fontSize": 12, "color": "text2", "breakLine": true },
      { "text": "▲ 34% YoY", "fontSize": 11, "color": "22C55E", "breakLine": true }
    ],
    "grid": { "column": 0, "row": 2, "columnSpan": 4, "rowSpan": 2 }
  }
}
```
Each segment can have its own `fontSize`, `fontFace`, `color`, `bold`, `italic`, `breakLine`, `spaceBefore`, and `spaceAfter`. Use `breakLine: true` to start a new line after the segment. Shape-level font props (`fontSize`, `fontColor`, `bold`) apply as defaults when segments omit them.

For truly complex layouts needing independent positioning, fall back to overlaying separate components:
- Use a `roundRect` shape as the card background (no text)
- Overlay positioned `text` components on top with explicit x/y/w/h
- All components share the same grid area but use absolute offsets within
