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
- Styling: `fontSize`, `fontFace`, `color`, `align`, `valign`, `bold`, `italic`
- `style` — optional named style (see Named Styles below); applies as defaults to all components in this placeholder

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
          { "name": "title", "type": "title", "style": "title", "grid": { "column": 1, "row": 1, "columnSpan": 10, "rowSpan": 2 }, "fontSize": 44, "color": "FFFFFF", "valign": "middle" },
          { "name": "subtitle", "type": "body", "style": "subtitle", "grid": { "column": 2, "row": 3, "columnSpan": 8 }, "color": "accent" }
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

## Named Styles

Themes define a `styles` map with predefined text style presets. Use `"style"` on text/shape components to apply formatting without repeating props.

**Available style names:** `title`, `subtitle`, `heading1`, `heading2`, `heading3`, `body`, `caption`

**Usage on components:**
```json
{ "name": "text", "props": { "text": "My Title", "style": "title" } }
{ "name": "shape", "props": { "type": "roundRect", "text": "KPI", "style": "caption", "fill": { "color": "background2" } } }
```

**Usage on placeholders:**
```json
{ "name": "heading", "type": "title", "style": "heading1", "grid": { "column": 0, "row": 0, "columnSpan": 12 } }
```

**Resolution cascade (most specific wins):**
`component props → component style → placeholder props → placeholder style → theme defaults`

Explicit props always override style values. Example: `"style": "heading1", "fontSize": 32` → uses 32pt, not the style's fontSize.

**Built-in defaults (all themes):**

| Style    | fontSize | bold | italic | fontColor | align  |
|----------|----------|------|--------|-----------|--------|
| title    | 36       | yes  |        | text      | center |
| subtitle | 20       |      | yes    | text2     | center |
| heading1 | 28       | yes  |        | primary   |        |
| heading2 | 22       | yes  |        | primary   |        |
| heading3 | 18       | yes  |        | text      |        |
| body     | 14       |      |        |           |        |
| caption  | 10       |      | yes    | text2     |        |

Heading styles (`title`, `heading1-3`) auto-use `theme.fonts.heading`; others use `theme.fonts.body`.

Themes can override styles in the `styles` key:
```json
"styles": {
  "title": { "fontSize": 40, "bold": true, "fontColor": "accent", "align": "left" }
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

## Available Components

Use these inside `placeholders` or `children`:
- **text** — headings, paragraphs, bullets. Props: `text`, `fontSize`, `bold`, `italic`, `color`, `align`, `bullet`, `lineSpacing`, `charSpacing`
- **shape** — rectangles, circles, arrows, etc. Props: `type` (rect, roundRect, ellipse, triangle, etc.), `fill`, `text` (string or `[{ text, fontSize?, color?, bold?, italic?, breakLine? }]` for rich text), `fontSize`, `fontColor`, `charSpacing`
- **table** — data grids. Props: `rows` (2D array of strings or cell objects), `colW`, `rowH`, `border`, `fontSize`, `margin`, `borderRadius`
- **image** — pictures. Props: `path` or `base64`, `sizing` ({ type: "cover"|"contain" })
- **chart** — **DEFAULT for all charts.** Native PowerPoint chart — editable, no external server. Always use this unless the user explicitly asks for Highcharts. Title, legend, and axis label colors auto-default to the theme's `text` color for proper contrast on any background. Props: `type` (area, bar, bar3D, bubble, doughnut, line, pie, radar, scatter), `data` (array of `{ name?, labels?, values?, sizes? }`), `showLegend`, `showTitle`, `title`, `titleColor`, `chartColors` (hex or semantic), `legendPos`, `legendColor`, axis options (`catAxisTitle`, `valAxisTitle`, `valAxisMinVal`, `valAxisMaxVal`, `valAxisLabelFormatCode`, `catAxisLabelColor`, `valAxisLabelColor`), bar options (`barDir`, `barGrouping`, `barGapWidthPct`), line options (`lineSmooth`, `lineDataSymbol`, `lineSize`), pie/doughnut (`firstSliceAng`, `holeSize`), radar (`radarStyle`), data labels (`dataLabelColor`, `dataLabelFontSize`, `dataLabelPosition`)
- **highcharts** — **ONLY use when the user explicitly requests Highcharts.** Renders charts via Highcharts as images (not editable in PowerPoint). Props: `chartOptions` (Highcharts options object), `width`, `height`
