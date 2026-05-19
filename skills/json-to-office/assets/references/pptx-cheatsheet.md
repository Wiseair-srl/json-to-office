# PPTX prop cheat-sheet

Curated reference for the most-used PPTX component props. For exhaustive coverage consult the schema at `assets/schemas/presentation.schema.json`, but **never read it whole** — it's >600KB. Grep it for a specific prop instead:

```bash
grep -A 5 '"valign"' assets/schemas/presentation.schema.json | head -20
```

## Document root

```json
{
  "name": "pptx",
  "props": {
    "title": "Q2 Review",
    "author": "Name",
    "theme": "minimal",
    "slideWidth": 10,
    "slideHeight": 5.625,
    "grid": { "columns": 12, "rows": 6, "padding": 0.55, "gutter": 0.2 }
  },
  "children": [
    /* slides */
  ]
}
```

`props.theme` must equal the `name` field of the theme being applied. Mismatch → silent fallback to default Office theme.

Slide dimensions are in inches. Defaults: 10 × 5.625 (16:9 small). PowerPoint default is 13.333 × 7.5; both work — pick by context.

## Slide

```json
{
  "name": "slide",
  "props": {
    "background": { "color": "background" },
    "notes": "Speaker notes — always include"
  },
  "children": [
    /* components */
  ]
}
```

`notes` is the speaker-notes string. Always populate it.

`background.color` accepts theme keys (`"background"`, `"primary"`) or bare hex (`"FAFAFA"` — no `#`).

## Positioning

Two modes. Never mix on the same node.

### Grid (preferred for content)

```json
"grid": { "column": 0, "row": 2, "columnSpan": 6, "rowSpan": 3 }
```

`column`/`row` are 0-indexed. `columnSpan`/`rowSpan` default to 1.

### Absolute (preferred for decorative shapes)

Either inches:

```json
"x": 0.55, "y": 1.75, "w": 9, "h": 2.2
```

Or percentages:

```json
"x": "92%", "y": "94%", "w": "8%", "h": "2.2%"
```

## Components

### `text`

```json
{
  "name": "text",
  "props": {
    "text": "Hello\nWorld",
    "fontSize": 16,
    "lineSpacing": 20,
    "fontFace": "Helvetica",
    "color": "text",
    "bold": true,
    "italic": false,
    "align": "left",
    "valign": "top",
    "style": "heading1",
    "grid": { "column": 0, "row": 2, "columnSpan": 12, "rowSpan": 2 }
  }
}
```

| Prop          | Notes                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `text`        | Literal string. `\n` for newlines.                                                                                                  |
| `fontSize`    | pt. **Must override `lineSpacing` together** — if you change one, change the other.                                                 |
| `lineSpacing` | pt. Multiple of 4. Approximate ratios: ×1.25 body, ×1.15 display, ×1.05 hero.                                                       |
| `color`       | **`color`, not `fontColor`** on text components. Bare hex (no `#`) or theme key.                                                    |
| `align`       | `"left"` / `"center"` / `"right"`                                                                                                   |
| `valign`      | `"top"` / `"middle"` / `"bottom"`. Prefer `"top"` for variable-length text — overflow extends down rather than colliding both ways. |
| `style`       | Theme style name. Resolves `fontSize`/`color`/`lineSpacing`/`bold` from theme.                                                      |

**No `transparency`** on text. Fake fading by using a `color` near the background.

### `shape`

```json
{
  "name": "shape",
  "props": {
    "type": "roundRect",
    "fill": { "color": "accent", "transparency": 50 },
    "line": { "color": "accent", "width": 0 },
    "rectRadius": 0.1,
    "text": "KPI Value",
    "fontSize": 18,
    "fontColor": "FFFFFF",
    "align": "center",
    "valign": "middle",
    "grid": { "column": 0, "row": 2, "columnSpan": 3, "rowSpan": 2 }
  }
}
```

| Prop                | Notes                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `type`              | `"rect"`, `"roundRect"`, `"ellipse"`, `"triangle"`, `"diamond"`, `"hexagon"`, `"star5"`, `"line"`, plus other PowerPoint shape names. |
| `fill.transparency` | 0 opaque → 100 invisible. Use for decorative dot clusters.                                                                            |
| `rectRadius`        | 0 – 1 (fraction of min dimension). Keep ≤0.1 unless intentionally chunky.                                                             |
| `text`              | Optional text inside the shape. Uses `fontColor` (not `color`) here.                                                                  |
| `fontColor`         | **`fontColor`, not `color`** on shape components.                                                                                     |

### `image`

```json
{
  "name": "image",
  "props": {
    "path": "https://example.com/img.png",
    "grid": { "column": 0, "row": 0, "columnSpan": 6, "rowSpan": 5 },
    "sizing": { "type": "cover" }
  }
}
```

`path` accepts URL or local absolute path. `sizing.type`: `"cover"` / `"contain"` / `"crop"`.

Placeholder for missing images:

```
https://placehold.co/{W}x{H}/{bg}/{fg}?text={TEXT}
```

### `table`

PPTX tables are **row-oriented** (DOCX tables are column-oriented — opposite).

```json
{
  "name": "table",
  "props": {
    "rows": [
      ["Header A", "Header B", "Header C"],
      ["Row1A", "Row1B", "Row1C"]
    ],
    "header": true,
    "fontSize": 11,
    "grid": { "column": 0, "row": 2, "columnSpan": 12, "rowSpan": 4 }
  }
}
```

Cells can be plain strings or `{ "text": "…", "color": "…", "bold": true, "align": "right" }`.

### `chart`

```json
{
  "name": "chart",
  "props": {
    "type": "bar",
    "data": [
      {
        "name": "Revenue",
        "labels": ["Q1", "Q2", "Q3", "Q4"],
        "values": [1.2, 2.4, 3.1, 4.2]
      }
    ],
    "grid": { "column": 0, "row": 2, "columnSpan": 8, "rowSpan": 4 }
  }
}
```

`type`: `"bar"`, `"line"`, `"pie"`, `"area"`, `"scatter"`, `"doughnut"`. Don't rely on default colors — set them via theme or per-series `color`.

### `highcharts`

Use when the `chart` component is too limited (custom annotations, advanced data viz). Accepts a full Highcharts config object.

## Common prop confusions

| Concept      | Text component | Shape component     | Theme style |
| ------------ | -------------- | ------------------- | ----------- |
| Text color   | `color`        | `fontColor`         | `fontColor` |
| Transparency | not supported  | `fill.transparency` | —           |
| Hex prefix   | no `#` (PPTX)  | no `#` (PPTX)       | —           |

Theme keys (`"primary"`, `"text"`, `"accent"`) always work. Reach for raw hex only when no theme key fits.

## Sizing units quick reference

| What                                                           | Unit                       |
| -------------------------------------------------------------- | -------------------------- |
| `slideWidth` / `slideHeight`                                   | inches                     |
| Component `x`, `y`, `w`, `h` (number)                          | inches                     |
| Component `x`, `y`, `w`, `h` (string `"42%"`)                  | percent of slide dimension |
| `fontSize`, `lineSpacing`, `paraSpaceBefore`, `paraSpaceAfter` | points                     |
| Margin/padding/gutter in `grid`                                | inches                     |

## Authoring checklist

Before validating:

- Every text element has explicit `lineSpacing` if it has `fontSize`.
- `color` (not `fontColor`) on text; `fontColor` (not `color`) on shape-with-text.
- No `#` on hex in PPTX components.
- Theme `name` matches document `props.theme`.
- Each slide has `props.notes`.
- Grid OR absolute, never both, on the same component.
- `lineSpacing`, `paraSpaceBefore`, `paraSpaceAfter` are multiples of 4.
- Ellipse `h_pct` corrected for aspect when meant to be a circle.
- `valign: "top"` on text whose content length is variable.

Then run `python3 <skill>/scripts/preflight.py …` before render.
