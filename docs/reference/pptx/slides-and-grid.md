# Slides & the grid

The grid system turns slide layout from pixel-pushing into declarative placement: you describe _which cells_ a component occupies, and the library computes the inches. Combined with templates and placeholders — reusable slide masters with named, pre-styled content regions — it is what makes json-to-office decks robust to theme swaps, slide-size changes, and programmatic content injection.

## Grid configuration

The grid is configured once on the `pptx` root via the `grid` prop (and optionally overridden per template):

| Field     | Type                                              | Default         | Description                                     |
| --------- | ------------------------------------------------- | --------------- | ----------------------------------------------- |
| `columns` | number ≥ 1                                        | `12`            | Number of grid columns.                         |
| `rows`    | number ≥ 1                                        | `6`             | Number of grid rows.                            |
| `margin`  | number \| `{ top, right, bottom, left }` (inches) | `0.5` all sides | Space between the slide edge and the grid area. |
| `gutter`  | number \| `{ column, row }` (inches)              | `0.2` both axes | Space between adjacent tracks.                  |

`margin` and `gutter` accept either a single number (applied uniformly) or the per-side / per-axis object form:

```json
{
  "name": "pptx",
  "props": {
    "slideWidth": 13.333,
    "slideHeight": 7.5,
    "grid": {
      "columns": 12,
      "rows": 12,
      "margin": { "top": 0.5, "right": 0.5, "bottom": 0.5, "left": 0.5 },
      "gutter": { "column": 0.16, "row": 0.16 }
    }
  }
}
```

This 12 × 12 setup trades the default's coarse 6 rows for fine-grained vertical control — a good choice for dense, designed layouts.

## Per-component placement

Every content component (`text`, `image`, `shape`, `table`, `chart`, `highcharts`) accepts a `grid` prop:

| Field        | Type       | Required | Default | Description                     |
| ------------ | ---------- | -------- | ------- | ------------------------------- |
| `column`     | number ≥ 0 | **yes**  | —       | Starting column, **0-indexed**. |
| `row`        | number ≥ 0 | **yes**  | —       | Starting row, **0-indexed**.    |
| `columnSpan` | number ≥ 1 | no       | `1`     | Number of columns to span.      |
| `rowSpan`    | number ≥ 1 | no       | `1`     | Number of rows to span.         |

```json
{
  "name": "text",
  "props": {
    "text": "Full-width heading",
    "style": "heading1",
    "grid": { "column": 0, "row": 0, "columnSpan": 12, "rowSpan": 1 }
  }
}
```

## Resolution math

At generation time each grid placement is resolved to absolute coordinates. With slide width `W`, margins `m`, gutter `g`, and `n` columns:

```
trackWidth = (W − m.left − m.right − (n − 1) · g) / n
x = m.left + column · (trackWidth + g)
w = columnSpan · trackWidth + (columnSpan − 1) · g
```

The same formulas apply vertically with slide height, `rows`, and the row gutter.

Worked example — the defaults (10 in wide, 12 columns, 0.5 in margins, 0.2 in gutter):

```
trackWidth = (10 − 0.5 − 0.5 − 11 × 0.2) / 12 = 6.8 / 12 ≈ 0.567 in
```

A component at `{ "column": 6, "columnSpan": 6 }` resolves to:

```
x = 0.5 + 6 × (0.567 + 0.2) = 5.1 in
w = 6 × 0.567 + 5 × 0.2 = 4.4 in
```

— exactly the right half of the content area. Because resolution happens at generation, changing `slideWidth` from 10 to 13.33 re-derives every position; grid-placed layouts survive the 4:3 → 16:9 switch untouched.

### Clamping

If `column`/`row` fall outside the grid, they are clamped back into range and a `GRID_POSITION_CLAMPED` pipeline warning is emitted (with the clamped coordinates); an out-of-range span is clamped silently, with no warning. The deck still generates — but treat the warning as a layout bug to fix.

### Mixing grid with explicit coordinates

Explicit `x`, `y`, `w`, `h` props on a component **individually override** the corresponding grid-resolved value. This is useful when the grid gets you 90% of the way and one dimension needs precision:

```json
{
  "name": "image",
  "props": {
    "path": "./logo.png",
    "grid": { "column": 0, "row": 0, "columnSpan": 3 },
    "h": 0.4
  }
}
```

Here `x`, `y`, and `w` come from the grid; `h` is pinned at 0.4 in. If an explicit value on an axis is a **percentage string** (e.g. `"h": "5%"`), the grid-resolved values on that same axis (`y`/`h`, or `x`/`w`) are converted to percentages of the slide dimensions too, so each axis reaches the underlying engine in consistent units.

### Template grid merging

A template may declare its own `grid`; the effective grid for a slide using that template is the presentation grid merged with the template grid, **template winning** field by field. Nested `margin`/`gutter` objects are normalized first and shallow-merged, so a template can override just `gutter.row` while inheriting everything else.

## Templates

Templates are reusable slide layouts declared once in the root `templates` array. Each becomes a slide master in the generated file; slides opt in via their `template` prop (see [Presentation & slide reference](/reference/pptx/presentation)).

### `TemplateSlideDefinition`

| Field          | Type                                            | Required | Description                                                                                                                                                                                                                                                           |
| -------------- | ----------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`         | string                                          | **yes**  | Unique template name; also the slide-master title in the generated file.                                                                                                                                                                                              |
| `background`   | `{ color?, image? }`                            | no       | Background applied to every slide using this template.                                                                                                                                                                                                                |
| `margin`       | number \| `[top, right, bottom, left]` (inches) | no       | Slide margin.                                                                                                                                                                                                                                                         |
| `slideNumber`  | `{ x, y, w?, h?, color?, fontSize? }`           | no       | Automatic slide-number placement and styling (`x`/`y` required; `fontSize` in points).                                                                                                                                                                                |
| `objects`      | content component array                         | no       | Fixed decorations rendered on every slide using the template — logos, footers, decorative shapes. Same `{ name, props }` format as slide children (text/image/shape/table/chart/highcharts), rendered through the normal component pipeline, grid placement included. |
| `placeholders` | `PlaceholderDefinition[]`                       | no       | Named content regions (below).                                                                                                                                                                                                                                        |
| `grid`         | GridConfig                                      | no       | Template-level grid override, merged over the presentation grid.                                                                                                                                                                                                      |

### `PlaceholderDefinition`

| Field              | Type                   | Required | Description                                                                                                                                                                                |
| ------------------ | ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`             | string                 | **yes**  | Unique placeholder name, referenced by slides.                                                                                                                                             |
| `x`, `y`, `w`, `h` | number (in) \| `"NN%"` | no       | Explicit position for the region.                                                                                                                                                          |
| `grid`             | GridPosition           | no       | Grid placement for the region — resolved to absolute inches against the effective (template-merged) grid when the document is processed.                                                   |
| `defaults`         | `{ name, props }`      | no       | A partial component stub: the component type expected here plus default props (styling, alignment, style preset — not content) inherited by whatever the slide places in this placeholder. |

### Defaults precedence

When a slide fills a placeholder, the final props of the rendered component are assembled from five layers, later layers winning:

1. Theme `componentDefaults` (from the active [theme](/reference/theme-schema))
2. Presentation `componentDefaults` (root prop)
3. Placeholder position (`x`/`y`/`w`/`h`, or grid resolved to them)
4. Placeholder `defaults.props`
5. The component's own `props` on the slide

In practice: templates own layout and look, slides own words and data.

### Warnings

| Code                      | Trigger                                                                 | Effect                                            |
| ------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------- |
| `MISSING_TEMPLATE`        | Slide's `template` names a template that doesn't exist                  | Slide renders without a master                    |
| `UNKNOWN_PLACEHOLDER`     | Slide's `placeholders` record uses a name the template doesn't define   | That entry is skipped — it is not rendered at all |
| `PLACEHOLDER_NO_POSITION` | A placeholder component ends up with no template and no position at all | Component is skipped                              |

All three surface in the `warnings` array of `generateBufferWithWarnings` (see [API reference](/reference/api)) with the offending slide.

## A complete example

Root configuration and one template, in the style of a dense corporate deck:

```json
{
  "name": "pptx",
  "props": {
    "title": "Quarterly review",
    "pageNumberFormat": "09",
    "slideWidth": 13.333,
    "slideHeight": 7.5,
    "grid": {
      "columns": 12,
      "rows": 12,
      "margin": { "top": 0.5, "right": 0.5, "bottom": 0.5, "left": 0.5 },
      "gutter": { "column": 0.16, "row": 0.16 }
    },
    "templates": [
      {
        "name": "TWO_COL_TEMPLATE",
        "background": { "color": "background" },
        "placeholders": [
          {
            "name": "heading",
            "grid": { "column": 0, "row": 1, "columnSpan": 12, "rowSpan": 1 },
            "defaults": {
              "name": "text",
              "props": { "style": "heading1", "fontSize": 28, "color": "text" }
            }
          },
          {
            "name": "leftTitle",
            "grid": { "column": 0, "row": 3, "columnSpan": 6 },
            "defaults": { "name": "text", "props": { "style": "heading3" } }
          },
          {
            "name": "rightTitle",
            "grid": { "column": 6, "row": 3, "columnSpan": 6 },
            "defaults": { "name": "text", "props": { "style": "heading3" } }
          },
          {
            "name": "left",
            "grid": { "column": 0, "row": 4, "columnSpan": 6, "rowSpan": 6 },
            "defaults": {
              "name": "text",
              "props": { "style": "body", "fontSize": 14, "color": "text2" }
            }
          },
          {
            "name": "right",
            "grid": { "column": 6, "row": 4, "columnSpan": 6, "rowSpan": 6 },
            "defaults": {
              "name": "text",
              "props": { "style": "body", "fontSize": 14, "color": "text2" }
            }
          }
        ]
      }
    ]
  },
  "children": [
    {
      "name": "slide",
      "props": {
        "template": "TWO_COL_TEMPLATE",
        "notes": "Two-column content — narrative left, bullets right.",
        "placeholders": {
          "heading": {
            "name": "text",
            "props": { "text": "Detailed content in two columns" }
          },
          "leftTitle": { "name": "text", "props": { "text": "The problem" } },
          "rightTitle": { "name": "text", "props": { "text": "Our take" } },
          "left": {
            "name": "text",
            "props": {
              "text": "Use this space for narrative text that provides depth and context.",
              "lineSpacing": 24
            }
          },
          "right": {
            "name": "text",
            "props": {
              "text": "First key point\nSecond key point\nThird key point",
              "lineSpacing": 28,
              "bullet": { "type": "bullet", "style": "●" }
            }
          }
        }
      }
    }
  ]
}
```

Note how the slide carries **zero layout information** — every position, font, and color comes from the template's placeholders and the theme. Adding a second slide with the same structure but different content is a copy-paste of the `placeholders` record.

::: tip Design templates once, fill them forever
This split is what makes json-to-office decks a good target for LLMs and automation: a designer (or the bundled starter templates) defines the `templates` array once, and content producers — human or machine — only ever write slides with `template` + `placeholders`. See [json-to-office for LLMs](/guide/llms) and the [examples](/examples/).
:::
