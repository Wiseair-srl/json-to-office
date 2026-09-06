# Slides & the grid

The grid system turns slide layout from pixel-pushing into declarative placement: you describe _which cells_ a component occupies, and the library computes the inches. Combined with groups — frames that nest a coordinate system and distribute children into cells — and with [JSON blocks](/reference/blocks#pptx), which own that geometry so a slide only supplies content, it is what makes json-to-office decks robust to theme swaps, slide-size changes, and programmatic content injection.

## Grid configuration

The grid is configured once on the `pptx` root via the `grid` prop (and optionally overridden per group through `gridConfig`, or per block definition through `slide.grid`):

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

### Group grid merging

A `group` may declare its own `gridConfig`; the effective grid for its descendants is the enclosing grid merged with that config, **the group winning** field by field. Nested `margin`/`gutter` objects are normalized first and shallow-merged. Inside a framed group the grid spans the frame, and the enclosing margin — the slide's safe area — is dropped unless the group's own config states one. A block definition's `slide.grid` becomes the `gridConfig` of the group it expands into, so a block's body resolves its grid placements against the block's own grid.

## Groups and frames

A `group` is a transparent container, and the inspectable result of block expansion. It comes in three strengths:

| Group                               | Behaviour                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No frame, no direction              | A plain sequence: its children position exactly as they would on the slide.                                                                                                                                                                                                                                                                     |
| A frame (`x`/`y`/`w`/`h` or `grid`) | A nested coordinate system. Inside it a child's numbers are offsets from the frame origin, percentages are fractions of the frame, and an omitted `x`/`y` or `w`/`h` means the frame's. Omitted frame sides fill the enclosing extent.                                                                                                          |
| A `direction`                       | The frame's enabled children are distributed into cells along the axis — equal, or by `weights` — separated by `gap`. A child fills its cell unless it states its own offsets. A child that is not there (an optional block slot left empty) is not counted, so the rest redistribute: two metrics take half the row each, four take a quarter. |

```json
{
  "name": "group",
  "props": {
    "x": 0.5,
    "y": 1.5,
    "w": 12.333,
    "h": 2.5,
    "direction": "row",
    "gap": 0.3
  },
  "children": [
    { "name": "text", "props": { "text": "+18%", "style": "stat" } },
    { "name": "text", "props": { "text": "94%", "style": "stat" } },
    { "name": "text", "props": { "text": "12", "style": "stat" } }
  ]
}
```

Three cells of `(12.333 − 2 × 0.3) / 3` inches, each text filling its cell. Add `"weights": [1.1, 1]` to a two-child row for a 1.1 : 1 split. Groups nest: a row of column groups is a row of tiles. A group holds what a slide holds — content components, blocks and groups — never a `slide` or the `pptx` root. Layout is decided once, before quality analysis and compilation, so the quality rules and the renderer read the same absolute boxes. The compiler then draws the children in order as slide elements; a group carries no geometry of its own into the file.

### Bounded fit

A `text` may declare `fit: { maxLines, shrink }`. The engine estimates the lines the text takes at its effective size; past `maxLines` — or the box height when `h` is set and no line count is — it steps down through the `shrink` sizes in order and takes the first that fits. Nothing else is tried: when no declared size fits, generation fails with `text_fit_overflow` at the text, or at the block slot the text came from. This is the bounded adaptation a two-line action title needs; automatic shrink-to-fit outside declared steps does not exist.

## A complete example

Root configuration and one block, in the style of a dense corporate deck:

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
    "blocks": {
      "two-column": {
        "slots": {
          "heading": { "type": "string", "required": true, "maxWords": 12 },
          "leftTitle": { "type": "string", "required": true },
          "rightTitle": { "type": "string", "required": true },
          "left": { "type": "component", "required": true },
          "right": { "type": "component", "required": true }
        },
        "slide": { "background": { "color": "background" } },
        "body": [
          {
            "name": "text",
            "props": {
              "text": { "$slot": "/heading" },
              "style": "heading1",
              "grid": { "column": 0, "row": 1, "columnSpan": 12, "rowSpan": 1 }
            }
          },
          {
            "name": "group",
            "props": {
              "grid": { "column": 0, "row": 3, "columnSpan": 12, "rowSpan": 7 },
              "direction": "row",
              "gap": 0.3
            },
            "children": [
              {
                "name": "group",
                "props": { "direction": "column", "weights": [1, 6] },
                "children": [
                  {
                    "name": "text",
                    "props": {
                      "text": { "$slot": "/leftTitle" },
                      "style": "heading3"
                    }
                  },
                  {
                    "$slot": "/left",
                    "props": {
                      "style": "body",
                      "fontSize": 14,
                      "color": "text2"
                    }
                  }
                ]
              },
              {
                "name": "group",
                "props": { "direction": "column", "weights": [1, 6] },
                "children": [
                  {
                    "name": "text",
                    "props": {
                      "text": { "$slot": "/rightTitle" },
                      "style": "heading3"
                    }
                  },
                  {
                    "$slot": "/right",
                    "props": {
                      "style": "body",
                      "fontSize": 14,
                      "color": "text2"
                    }
                  }
                ]
              }
            ]
          }
        ]
      }
    }
  },
  "children": [
    {
      "name": "slide",
      "props": {
        "notes": "Two-column content — narrative left, bullets right."
      },
      "children": [
        {
          "name": "block",
          "props": {
            "ref": "two-column",
            "slots": {
              "heading": "Detailed content in two columns",
              "leftTitle": "The problem",
              "rightTitle": "Our take",
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
  ]
}
```

Note how the slide carries **zero layout information** — every position, size and colour comes from the definition and the theme, and the two columns are a row group distributing two column groups. A component supplied through a slot takes the definition's `props` beneath its own: the `style` and `color` defaults above may be overridden by the slot content, the frame may not. Adding a second slide with the same structure but different content is a copy-paste of the `slots` record.

::: tip Design a definition once, fill it forever
This split is what makes json-to-office decks a good target for LLMs and automation: a designer (or a definition copied from `jto://blocks`) writes `props.blocks` once, and content producers — human or machine — only ever write slides with `ref` + `slots`. See [JSON blocks](/reference/blocks#pptx), [json-to-office for LLMs](/guide/llms) and the [examples](/examples/).
:::
