# PPTX Presentation Guidelines

## Architecture

A PPTX presentation has this structure:

```
pptx.props.masters[]        → reusable slide layouts (defined once)
pptx.children[].props.master → slide references a master by name
pptx.children[].props.placeholders → slide fills master's named regions
```

**Master slides are the foundation of every presentation.** Every slide MUST reference a master. Masters enforce visual consistency, reduce repetition, and let placeholders carry default styling so slides stay minimal. Custom (masterless) slides are an absolute last resort.

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
- Styling: `fontSize`, `fontFace`, `color`, `align`, `valign`, `bold`, `italic`, `lineSpacing`
- `style` — optional named style (see Named Styles below); applies as defaults to all components in this placeholder

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
        { "name": "text", "props": { "text": "Key insight here." } },
        { "name": "shape", "props": { "type": "roundRect", "fill": { "color": "background2" }, "text": "100+\nCustomers", "fontSize": 16, "bold": true, "fontColor": "primary", "align": "center", "valign": "middle", "grid": { "column": 0, "row": 3, "columnSpan": 4 } } }
      ]
    }
  }
}
```

Components inside placeholders use grid positions relative to the slide (not the placeholder).

### Placeholder inheritance

Components inside placeholders automatically inherit these props from the placeholder definition — **do NOT re-specify a prop if the placeholder already defines it:**

`fontSize`, `fontFace`, `color`, `bold`, `italic`, `align`, `valign`, `margin`, `charSpacing`, `lineSpacing`, `style`, plus position (`x`/`y`/`w`/`h` or `grid`).

Resolution order: `component props → component style → placeholder props → placeholder style → theme defaults`

**Good** — placeholder defines `fontSize: 14`, component omits it:
```json
{ "name": "text", "props": { "text": "Key insight here." } }
```

**Bad** — redundantly re-specifying what the placeholder already provides:
```json
{ "name": "text", "props": { "text": "Key insight here.", "fontSize": 14, "grid": { "column": 0, "row": 2, "columnSpan": 12 } } }
```

Only override a placeholder prop when you genuinely need a different value for that specific component.

## Semantic Colors

Use theme color names, not hex codes:
- `primary`, `secondary`, `accent` — brand colors
- `background`, `background2` — surface colors
- `text`, `text2` — text colors
- `accent4`, `accent5`, `accent6` — additional accents

Only use hex (e.g. `"FFFFFF"`) for absolute white/black when needed.

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

## Available Components

Use these inside `placeholders` or `children`:
- **text** — headings, paragraphs, bullets. Props: `text`, `fontSize`, `bold`, `italic`, `color`, `align`, `bullet`, `lineSpacing`, `charSpacing`
- **shape** — rectangles, circles, arrows, etc. Props: `type` (rect, roundRect, ellipse, triangle, etc.), `fill`, `text` (string or `[{ text, fontSize?, color?, bold?, italic?, breakLine? }]` for rich text), `fontSize`, `fontColor`, `charSpacing`
- **table** — data grids. Props: `rows` (2D array of strings or cell objects), `colW`, `rowH`, `border`, `fontSize`, `margin`, `borderRadius`
- **image** — pictures. Props: `path` or `base64`, `sizing` ({ type: "cover"|"contain" })
- **chart** — **DEFAULT for all charts.** Native PowerPoint chart — editable, no external server. Always use this unless the user explicitly asks for Highcharts. Title, legend, and axis label colors auto-default to the theme's `text` color for proper contrast on any background. Props: `type` (area, bar, bar3D, bubble, doughnut, line, pie, radar, scatter), `data` (array of `{ name?, labels?, values?, sizes? }`), `showLegend`, `showTitle`, `title`, `titleColor`, `chartColors` (hex or semantic), `legendPos`, `legendColor`, axis options (`catAxisTitle`, `valAxisTitle`, `valAxisMinVal`, `valAxisMaxVal`, `valAxisLabelFormatCode`, `catAxisLabelColor`, `valAxisLabelColor`), bar options (`barDir`, `barGrouping`, `barGapWidthPct`), line options (`lineSmooth`, `lineDataSymbol`, `lineSize`), pie/doughnut (`firstSliceAng`, `holeSize`), radar (`radarStyle`), data labels (`dataLabelColor`, `dataLabelFontSize`, `dataLabelPosition`)
- **highcharts** — **ONLY use when the user explicitly requests Highcharts.** Renders charts via Highcharts as images (not editable in PowerPoint). Props: `chartOptions` (Highcharts options object), `width`, `height`
