# PPTX Presentation Guidelines

## Architecture

A PPTX presentation is one JSON tree:

```
pptx.props                     → deck settings: title, theme, slideWidth/slideHeight, grid
pptx.props.blocks              → reusable slide layouts, defined once as JSON (name → definition)
pptx.children[]                → slides
slide.children[]               → content: block invocations and/or positioned components
```

**Blocks are the foundation of every presentation.** A block definition owns a layout — every coordinate, every type role, every theme binding — and names the content it takes as `slots`. A slide invokes it with `{ "name": "block", "props": { "ref": "<name>", "slots": { ... } } }` and supplies only words and data. Define each standard layout once in `props.blocks` and invoke it on every slide that uses it; coordinate-authored slides are for one-off layouts only.

There are no slide templates, placeholders or a `layout` prop. Never emit `templates`, `template` or `placeholders` keys: they are rejected.

## Block definitions

```json
"blocks": {
  "statement": {
    "description": "One sentence on an otherwise empty slide.",
    "slots": {
      "text": { "type": "string", "required": true, "maxWords": 30, "role": "actionTitle" },
      "source": { "type": "string", "maxWords": 20, "role": "source" }
    },
    "body": [
      {
        "name": "text",
        "props": {
          "text": { "$slot": "/text" },
          "style": "display",
          "fontSize": { "$theme": "/styles/display/fontSize", "default": 28 },
          "x": "3.75%", "y": "30%", "w": "92.5%", "h": "30%",
          "valign": "middle",
          "fit": { "maxLines": 3, "shrink": [24, 22] }
        }
      },
      {
        "$if": "/source",
        "then": {
          "name": "text",
          "props": {
            "text": { "$slot": "/source" },
            "style": "source",
            "fontSize": { "$theme": "/styles/source/fontSize", "default": 9 },
            "x": "3.75%", "y": "94.5%", "w": "75%", "h": "5%"
          }
        }
      }
    ]
  }
}
```

- `slots` — named inputs: `type` (`string`, `number`, `integer`, `boolean`, `object`, `array`, `component`), `required`, `default`, `description`, constraints (`maxWords`, `oneLine`, `minItems`/`maxItems`, `enum`), and an optional `role` (`actionTitle`, `takeaway`, `source`, `tracker`, `footer`) so a quality profile can require or measure it.
- `body` — ordinary slide content, expanded at the invocation. Bindings read inputs: `{ "$slot": "/title" }`, `{ "$theme": "/styles/display/fontSize", "default": 28 }` (always give theme bindings a `default`), `{ "$context": "/slide/width" }`, `{ "$if": "/source", "then": [...] , "else": [...] }` (an omitted optional slot collapses its region, decorations included), `{ "$each": "/items", "template": { ... } }` with `{ "$item": "/label" }`, `{ "$count": "/items" }`, `{ "$join": [...], "separator": " " }`, `{ "$measure": "width", "fraction": 0.5, "unit": "in" }`.
- A component slot is placed with `{ "$slot": "/chart", "props": { "x": "0%", "y": "29%", "w": "68%", "h": "62%", ... } }`: the definition's props sit beneath the slot content's own. The content may not carry `x`, `y`, `w`, `h`, `position` or `grid`.
- `slide` — optional `{ "background", "notes", "grid" }` the invoking slide inherits unless it states its own.
- **Geometry as percentages of the slide** (`"x": "3.75%"`) so the definition lays out on every canvas; sizes bound to type roles with defaults so it renders on every theme.

### Engine operations inside a body

- **Frame** — a `group` with `x`/`y`/`w`/`h` (or `grid`) is a nested coordinate system: children position relative to it; omitted `x`/`y` or `w`/`h` mean the frame's own.
- **Distribution** — a `group` with `"direction": "row" | "column"`, optional `gap` and `weights`, gives each child an equal or weighted cell. An `$each` inside a row redistributes for two, three or four items; an `$if` child that collapsed is not counted.
- **Bounded fit** — `text.fit: { "maxLines", "shrink": [24, 22] }` steps a title down through the declared sizes when it does not fit, then fails generation rather than spilling.
- **Nested grid** — `group.gridConfig` for grid placements inside the group.

## Invoking a block on a slide

```json
{
  "name": "slide",
  "props": { "meta": { "title": "Revenue" } },
  "children": [
    {
      "name": "block",
      "props": {
        "ref": "action-chart",
        "slots": {
          "title": "Revenue grew 18% as on-time delivery reached 94% of contracted work",
          "tracker": "Performance",
          "chart": {
            "name": "chart",
            "props": {
              "type": "bar",
              "valAxisTitle": "Revenue (€m)",
              "data": [{ "name": "Revenue", "labels": ["Q1", "Q2", "Q3", "Q4"], "values": [4.2, 4.6, 5.1, 5.6] }]
            }
          },
          "takeaway": "Reliability, not price, drove the gain.",
          "source": "Source: quarterly operating review, 2026."
        }
      }
    }
  ]
}
```

- An invocation accepts only `ref` and `slots` — no coordinates, no styling. The `ref` must name a definition in this document's `props.blocks`; nothing is built in.
- Fill every `required` slot; omit an optional slot and its region disappears.
- Slot content honours the slot's constraints (`maxWords`, `oneLine`); a chart or image placed in a component slot carries its data, never its position.
- Blocks and coordinate-authored components mix freely on one slide; a block with `slide` effects must be a direct child of the slide.
- Label every slide with `"meta": { "title": "..." }` (authoring-only, never rendered) so editors show a navigable outline.

## Grid positioning (coordinate-authored content)

Grid is a **presentation-level** prop (on `pptx.props`), not a theme-level setting:

```json
{
  "name": "pptx",
  "props": {
    "theme": "consulting",
    "slideWidth": 13.333,
    "slideHeight": 7.5,
    "grid": { "columns": 12, "rows": 8, "margin": 0.5, "gutter": 0.2 }
  }
}
```

Use the grid instead of absolute x/y/w/h for one-off slides: `"grid": { "column": 0, "row": 1, "columnSpan": 6, "rowSpan": 2 }`. Columns 0–11, rows 0–(rows−1). Explicit `x`/`y`/`w`/`h` override grid when both are present. Always declare `slideWidth`/`slideHeight` (13.333 × 7.5 for 16:9); omitted, the deck falls back to 4:3.

## Semantic colors

Use theme color names, not hex codes: `primary`, `secondary`, `accent` (brand), `background`, `background2` (surfaces), `text`, `text2` (text), `accent4`, `accent5`, `accent6` (additional accents). Only use hex (e.g. `"FFFFFF"`) for absolute white/black when needed.

## Named styles

Themes define a `styles` map of text presets. Use `"style"` on text/shape components to apply formatting without repeating props: `title`, `subtitle`, `heading1`, `heading2`, `heading3`, `body`, `caption`, plus the type roles a theme declares (`display`, `eyebrow`, `stat`, `quote`, `label`, `footer`, `tracker`, `source`). Explicit props override style values; inside a block, bind the size to the role and give it a default: `"fontSize": { "$theme": "/styles/display/fontSize", "default": 28 }`.

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

## Available components

Use these inside `slide.children`, a block `body`, or a component slot:
- **text** — headings, paragraphs, bullets. Props: `text`, `style`, `fontSize`, `bold`, `italic`, `color`, `align`, `valign`, `bullet`, `lineSpacing`, `charSpacing`, `paraSpaceAfter`, `fit`
- **shape** — rectangles, circles, lines, arrows. Props: `type` (rect, roundRect, ellipse, line, triangle, …), `fill`, `line`, `text` (string or rich segments), `fontSize`, `fontColor`, `charSpacing`
- **table** — data grids. Props: `rows` (2D array of strings or cell objects), `colW`, `rowH`, `border`, `fontSize`, `margin`, `borderRadius`
- **image** — pictures. Props: `path` or `base64`, `sizing` ({ type: "cover"|"contain" })
- **chart** — **DEFAULT for all charts.** Native PowerPoint chart — editable, no external server. Props: `type` (area, bar, bar3D, bubble, doughnut, line, pie, radar, scatter), `data` (array of `{ name?, labels?, values?, sizes? }`), `showLegend`, `legendPos`, `chartColors` (semantic names), `title`, axis options (`catAxisTitle`, `valAxisTitle`, `valAxisMinVal`, `valAxisMaxVal`, `valAxisLabelFormatCode`), bar options (`barDir`, `barGrouping`), line options (`lineSmooth`, `lineDataSymbol`), pie/doughnut (`holeSize`), data labels (`dataLabelPosition`)
- **highcharts** — **ONLY when the user explicitly requests Highcharts.** Renders as an image. Props: `chartOptions`, `width`, `height`
- **group** — transparent container; a frame with `x`/`y`/`w`/`h`, a row or column with `direction`
- **block** — invoke a definition from `props.blocks`

Every component is `{ "name": "<type>", "props": { ... } }`. Never `{ "type": "...", ... }` with flat props. For page numbers, use a text component with `"text": "{PAGE_NUMBER} / {PAGE_COUNT}"`.
