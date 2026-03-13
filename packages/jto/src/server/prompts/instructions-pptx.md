# PPTX Presentation Guidelines

## Architecture

A PPTX presentation has this structure:

```
pptx.props.masters[]        → reusable slide layouts (defined once)
pptx.children[].props.master → slide references a master by name
pptx.children[].props.placeholders → slide fills master's named regions
```

**Always use master slides.** They enforce visual consistency and reduce repetition.

## Master Slide Definition

Each master has:
- `name` — unique identifier (SCREAMING_SNAKE_CASE)
- `background` — optional, color or image
- `objects[]` — fixed decorations (rects, text, lines) that appear on every slide using this master
- `placeholders[]` — named content regions that slides fill with components
- `slideNumber` — optional, position and style of auto slide numbers
- `grid` — optional grid override, merged with the theme grid. Use this to shift the content area below header bars. Example: `"grid": { "margin": { "top": 1.1 } }` pushes row 0 below a 0.9" header.

### Object types in `objects[]`

**Important:** Fixed decorations (header bars, footer bars) must use absolute `x`/`y`/`w`/`h`, not grid — because the master's `grid` override shifts grid positions, and decorations shouldn't shift themselves.

```json
{ "rect": { "x": 0, "y": 0, "w": 10, "h": 0.9, "fill": "primary" } }
{ "text": { "text": "COMPANY", "x": 0.6, "y": 0.15, "w": 4, "h": 0.6, "fontSize": 14, "bold": true, "color": "FFFFFF" } }
{ "line": { "x": 0.5, "y": 2, "w": 9, "h": 0, "line": { "color": "accent", "width": 1 } } }
{ "image": { "path": "logo.png", "x": 8.5, "y": 0.15, "w": 1, "h": 0.6 } }
```

### Placeholder definition

```json
{
  "name": "body",
  "type": "body",
  "grid": { "column": 0, "row": 2, "columnSpan": 12, "rowSpan": 3 },
  "fontSize": 14
}
```

- `name` — key used in `slide.props.placeholders` to fill this region
- `type` — `title`, `body`, `pic`, `chart`, `tbl`, `media`
- Position via `grid` (preferred) or `x`/`y`/`w`/`h`
- Styling: `fontSize`, `fontFace`, `color`, `align`, `valign`

## Recommended Master Set

Always define at least these 2-3 masters:

1. **TITLE_MASTER** — full-bleed title slide. Placeholders: `title`, `subtitle`
2. **CONTENT_MASTER** — standard content slide with heading + body. Placeholders: `heading`, `body`
3. **TWO_COLUMN_MASTER** — heading + left/right columns. Placeholders: `heading`, `left`, `right`

## Grid Positioning (preferred)

Use the 12-column × 6-row grid instead of absolute x/y/w/h:

```json
"grid": { "column": 0, "row": 1, "columnSpan": 6, "rowSpan": 2 }
```

- Columns: 0–11, Rows: 0–5
- Grid respects theme margins (default 0.5") and gutters (default 0.2")
- Use `columnSpan`/`rowSpan` to size elements
- Explicit `x`/`y`/`w`/`h` override grid when both are present

## Filling Placeholders (Slide Level)

Slides reference a master and fill its placeholders with component arrays:

```json
{
  "name": "slide",
  "props": {
    "master": "CONTENT_MASTER",
    "placeholders": {
      "heading": [
        { "name": "text", "props": { "text": "Slide Title" } }
      ],
      "body": [
        { "name": "text", "props": { "text": "Key insight here.", "grid": { "column": 0, "row": 2, "columnSpan": 12 } } },
        { "name": "shape", "props": { "type": "roundRect", "fill": { "color": "background2" }, "text": "100+\nCustomers", "fontSize": 16, "bold": true, "fontColor": "primary", "align": "center", "valign": "middle", "grid": { "column": 0, "row": 3, "columnSpan": 4 } } }
      ]
    }
  }
}
```

Components inside placeholders use grid positions relative to the slide (not the placeholder).

## Custom Slides (no master)

For one-off layouts, skip `master`/`placeholders` and use `children` directly:

```json
{
  "name": "slide",
  "props": { "background": { "color": "primary" } },
  "children": [
    { "name": "text", "props": { "text": "Special Layout", "grid": { "column": 1, "row": 2, "columnSpan": 10 }, "fontSize": 36, "color": "FFFFFF", "align": "center" } }
  ]
}
```

Only use this for truly unique slides. Prefer masters for repeating layouts.

## Semantic Colors

Use theme color names, not hex codes:
- `primary`, `secondary`, `accent` — brand colors
- `background`, `background2` — surface colors
- `text`, `text2` — text colors
- `accent4`, `accent5`, `accent6` — additional accents

Only use hex (e.g. `"FFFFFF"`) for absolute white/black when needed.

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
          { "rect": { "x": 0, "y": 6.8, "w": 10, "h": 0.7, "fill": "secondary" } }
        ],
        "placeholders": [
          { "name": "title", "type": "title", "grid": { "column": 1, "row": 1, "columnSpan": 10, "rowSpan": 2 }, "fontSize": 44, "color": "FFFFFF", "align": "center", "valign": "middle" },
          { "name": "subtitle", "type": "body", "grid": { "column": 2, "row": 3, "columnSpan": 8 }, "fontSize": 20, "color": "accent", "align": "center" }
        ]
      },
      {
        "name": "CONTENT_MASTER",
        "grid": { "margin": { "top": 1.1 } },
        "objects": [
          { "rect": { "x": 0, "y": 0, "w": 10, "h": 0.9, "fill": "primary" } },
          { "text": { "text": "COMPANY", "x": 0.6, "y": 0.15, "w": 4, "h": 0.6, "fontSize": 14, "bold": true, "color": "FFFFFF" } }
        ],
        "slideNumber": { "x": 9, "y": 6.85, "w": 0.5, "h": 0.5, "color": "text2", "fontSize": 8 },
        "placeholders": [
          { "name": "heading", "type": "title", "grid": { "column": 0, "row": 0, "columnSpan": 12 }, "fontSize": 28, "color": "primary" },
          { "name": "body", "type": "body", "grid": { "column": 0, "row": 1, "columnSpan": 12, "rowSpan": 4 }, "fontSize": 14 }
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
          "title": [{ "name": "text", "props": { "text": "Q1 2026 Update" } }],
          "subtitle": [{ "name": "text", "props": { "text": "Engineering Division" } }]
        }
      }
    },
    {
      "name": "slide",
      "props": {
        "master": "CONTENT_MASTER",
        "placeholders": {
          "heading": [{ "name": "text", "props": { "text": "Highlights" } }],
          "body": [
            { "name": "text", "props": { "text": "Shipped 3 major features ahead of schedule.", "grid": { "column": 0, "row": 2, "columnSpan": 12 }, "lineSpacing": 26 } },
            { "name": "table", "props": { "rows": [["Feature", "Status"], ["Search v2", "Shipped"], ["Auth rewrite", "In Progress"]], "grid": { "column": 0, "row": 3, "columnSpan": 12, "rowSpan": 2 }, "fontSize": 12, "border": { "type": "solid", "pt": 0.5, "color": "E2E8F0" } } }
          ]
        }
      }
    }
  ]
}
```

## Available Components

Use these inside `placeholders` or `children`:
- **text** — headings, paragraphs, bullets. Props: `text`, `fontSize`, `bold`, `italic`, `color`, `align`, `bullet`, `lineSpacing`
- **shape** — rectangles, circles, arrows, etc. Props: `type` (rect, roundRect, ellipse, triangle, etc.), `fill`, `text`, `fontSize`, `fontColor`
- **table** — data grids. Props: `rows` (2D array of strings or cell objects), `colW`, `border`, `fontSize`
- **image** — pictures. Props: `path` or `base64`, `sizing` ({ type: "cover"|"contain" })
- **highcharts** — charts via Highcharts config. Props: `chartOptions` (Highcharts options object), `width`, `height`
