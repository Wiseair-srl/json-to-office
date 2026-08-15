# PPTX components

This page is the full props reference for the four non-chart components you can place on a slide: `text`, `image`, `shape`, and `table`. For the two chart components (`chart` and `highcharts`) see [PPTX charts](/reference/pptx/charts); for slide structure, templates, and the grid system see [Slides & grid](/reference/pptx/slides-and-grid).

Every component is a JSON object of the form `{ "name": "...", "props": { ... } }`, optionally with `id` and `enabled` (set `"enabled": false` to skip a component at render time without deleting it).

## Shared conventions

### Position units

All position and size props (`x`, `y`, `w`, `h`) accept either a **number in inches** or a **percentage string** like `"50%"` (relative to the slide dimensions). Alternatively, place components with the `grid` prop — a `{ column, row, columnSpan?, rowSpan? }` object resolved against the slide's grid. Explicit `x`/`y`/`w`/`h` values override the grid-resolved value individually. See [Slides & grid](/reference/pptx/slides-and-grid) for the full grid model.

### Alignment enums

- Horizontal `align`: `left` | `center` | `right`
- Vertical `valign`: `top` | `middle` | `bottom`

### Shadow

`text`, `image`, and `shape` accept a `shadow` object. All fields are optional; the renderer fills in defaults:

| Field     | Type                   | Renderer default | Description               |
| --------- | ---------------------- | ---------------- | ------------------------- |
| `type`    | `'outer'` \| `'inner'` | `'outer'`        | Shadow direction          |
| `color`   | string (hex)           | `'000000'`       | Shadow color              |
| `blur`    | number (pt)            | `3`              | Blur radius               |
| `offset`  | number (pt)            | `3`              | Distance from the element |
| `angle`   | number (deg)           | `45`             | Direction of the offset   |
| `opacity` | number (0–1)           | `0.5`            | Shadow opacity            |

```json
{ "shadow": { "type": "outer", "blur": 6, "offset": 2, "opacity": 0.3 } }
```

### Hyperlink

`text` and `image` accept a `hyperlink` object: `{ "url"?: string, "slide"?: number, "tooltip"?: string }` — either an external URL or a slide number within the deck.

### Colors

Any color prop accepts a hex value (`"FF0000"` or `"#FF0000"`) or a **semantic theme name** (`primary`, `secondary`, `accent`, `background`, `text`, `text2`, `background2`, `accent4`, `accent5`, `accent6`). 3-char shorthand (`"F00"`) is expanded at render time, but props typed with the strict color schema — notably `shadow.color` — reject it at validation, so use 6-char hex there. Semantic names resolve against the active theme, so the same document re-renders correctly under any theme — see [Themes & styling](/guide/themes) and the [theme schema](/reference/theme-schema).

---

## `text`

A text box. The most feature-rich component: it participates in the theme's style-preset cascade (component props override the named `style`, which overrides theme defaults).

| Prop               | Type                          | Default                 | Description                                                                                                                                                                    |
| ------------------ | ----------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `text`             | string                        | **required**            | Text content. Supports `{PAGE_NUMBER}` and `{PAGE_COUNT}` placeholders, formatted per the presentation's `pageNumberFormat` (see [Presentation](/reference/pptx/presentation)) |
| `x`, `y`, `w`, `h` | number (in) \| `"NN%"`        | —                       | Position and size. See auto-height below                                                                                                                                       |
| `grid`             | GridPosition                  | —                       | Grid placement (`{ column, row, columnSpan?, rowSpan? }`)                                                                                                                      |
| `style`            | string                        | —                       | Named style preset: `title`, `subtitle`, `heading1`–`heading3`, `body`, `caption`                                                                                              |
| `fontSize`         | number ≥ 1 (pt)               | style → theme default   | Font size                                                                                                                                                                      |
| `fontFace`         | string                        | style → theme font      | Falls back to the theme heading font for `title`/`heading*` styles, body font otherwise. See [Fonts](/guide/fonts)                                                             |
| `color`            | string                        | style → theme default   | Hex or semantic color                                                                                                                                                          |
| `bold`             | boolean                       | —                       | Bold text                                                                                                                                                                      |
| `fontWeight`       | integer 100–900               | —                       | Numeric weight; overrides `bold`. See note below                                                                                                                               |
| `italic`           | boolean                       | —                       | Italic text                                                                                                                                                                    |
| `underline`        | boolean \| object             | —                       | `true` renders a single underline; the object form is `{ "style"?: "sng" \| "dbl" \| "dash" \| "dotted", "color"?: string }`                                                   |
| `strike`           | boolean                       | —                       | Strikethrough                                                                                                                                                                  |
| `language`         | string (BCP-47)               | presentation `language` | Spell-check language override, e.g. `"it-IT"`                                                                                                                                  |
| `align`            | `left` \| `center` \| `right` | style                   | Horizontal alignment                                                                                                                                                           |
| `valign`           | `top` \| `middle` \| `bottom` | `'top'`                 | Vertical alignment                                                                                                                                                             |
| `breakLine`        | boolean                       | —                       | Force a line break after this text run                                                                                                                                         |
| `bullet`           | boolean \| object             | —                       | `true` for a plain bullet; object form `{ "type"?: "bullet" \| "number", "style"?: string, "startAt"?: number }`                                                               |
| `margin`           | number \| `[t, r, b, l]` (pt) | `0`                     | Inner text-box margin; zero by default so text aligns exactly to the grid                                                                                                      |
| `rotate`           | number (deg)                  | —                       | Rotation                                                                                                                                                                       |
| `shadow`           | Shadow                        | —                       | Text shadow (see [Shadow](#shadow))                                                                                                                                            |
| `fill`             | `{ color, transparency? }`    | —                       | Text-box background fill; `transparency` is 0–100                                                                                                                              |
| `hyperlink`        | `{ url?, slide?, tooltip? }`  | —                       | Link on the whole text box                                                                                                                                                     |
| `lineSpacing`      | number (pt)                   | style                   | Line spacing                                                                                                                                                                   |
| `charSpacing`      | number (pt)                   | style                   | Character (letter) spacing                                                                                                                                                     |
| `paraSpaceBefore`  | number (pt)                   | —                       | Space before the paragraph                                                                                                                                                     |
| `paraSpaceAfter`   | number (pt)                   | style                   | Space after the paragraph                                                                                                                                                      |

**Auto-height**: when `h` is omitted the renderer computes it as `max(0.5, fontSize / 72 × 1.6 × lineCount)` and marks the element as a text box, so short labels don't reserve a full grid cell of height.

**`fontWeight` aliasing**: numeric weights map onto real font variants. The renderer picks the closest registered weight of the family and rewrites `fontFace` to a synthetic family alias (e.g. `Inter` at weight 300 becomes "Inter Light"), because PowerPoint itself only understands regular/bold. This works for any registered multi-weight family — see [Fonts](/guide/fonts).

```json
{
  "name": "text",
  "props": {
    "text": "Quarterly results",
    "style": "title",
    "color": "primary",
    "shadow": { "blur": 4, "opacity": 0.25 },
    "grid": { "column": 0, "row": 0, "columnSpan": 12, "rowSpan": 2 }
  }
}
```

---

## `image`

Embeds a raster image or inline SVG.

| Prop               | Type                         | Default | Description                                                               |
| ------------------ | ---------------------------- | ------- | ------------------------------------------------------------------------- |
| `path`             | string                       | — \*    | File path or URL                                                          |
| `base64`           | string                       | — \*    | Base64 data-URI content                                                   |
| `svg`              | string                       | — \*    | Raw inline SVG markup, embedded as a vector (renders in PowerPoint 2016+) |
| `x`, `y`, `w`, `h` | number \| `"NN%"`            | —       | Position and size                                                         |
| `sizing`           | `{ type, w?, h? }`           | —       | `type`: `contain` \| `cover` \| `crop` (see below)                        |
| `rotate`           | number (deg)                 | —       | Rotation                                                                  |
| `rounding`         | boolean                      | —       | Rounds the image into a circle                                            |
| `shadow`           | Shadow                       | —       | Drop shadow (see [Shadow](#shadow))                                       |
| `hyperlink`        | `{ url?, slide?, tooltip? }` | —       | Click-through link                                                        |
| `alt`              | string                       | —       | Accessibility alt text                                                    |
| `grid`             | GridPosition                 | —       | Grid placement                                                            |

\* **Exactly one source is required.** Providing more than one non-empty source (`path` + `base64`, etc.) fails both validation and generation with a `mutually_exclusive` error; providing none produces an `IMAGE_NO_SOURCE` warning and the image is skipped.

**Aspect-ratio auto-sizing**: if you give exactly one of `w`/`h` (and no `sizing`), the library probes the image's intrinsic dimensions and computes the other side to preserve the aspect ratio.

**`sizing` modes**:

- `contain` — fit the whole image inside the box, centered, preserving aspect ratio (implemented in-house with a probe-and-fit pass for correct results).
- `cover` — fill the box, cropping overflow, preserving aspect ratio.
- `crop` — crop to the given `w`/`h` region.

::: warning Remote and local sources are sandboxed
Image probing blocks private/loopback URLs and local paths outside the current working directory. Use `base64` or `svg` for fully self-contained documents.
:::

```json
{
  "name": "image",
  "props": {
    "path": "assets/team-photo.jpg",
    "sizing": { "type": "cover" },
    "alt": "The team at the 2026 offsite",
    "grid": { "column": 6, "row": 1, "columnSpan": 6, "rowSpan": 4 }
  }
}
```

---

## `shape`

A geometric shape, optionally with text inside it. With `text` set, the renderer emits a text box shaped like the geometry; without it, a plain shape.

**Shape types** (`type` is required). Left column is what you write; right column is the underlying pptxgenjs shape it maps to:

| `type`      | pptxgenjs shape |
| ----------- | --------------- |
| `rect`      | `rect`          |
| `roundRect` | `roundRect`     |
| `ellipse`   | `ellipse`       |
| `triangle`  | `triangle`      |
| `diamond`   | `diamond`       |
| `pentagon`  | `pentagon`      |
| `hexagon`   | `hexagon`       |
| `star5`     | `star5`         |
| `star6`     | `star6`         |
| `line`      | `line`          |
| `arrow`     | `rightArrow`    |
| `chevron`   | `chevron`       |
| `cloud`     | `cloud`         |
| `heart`     | `heart`         |
| `lightning` | `lightningBolt` |

| Prop                                                                               | Type                            | Default             | Description                                                                 |
| ---------------------------------------------------------------------------------- | ------------------------------- | ------------------- | --------------------------------------------------------------------------- |
| `type`                                                                             | ShapeType                       | **required**        | One of the 15 types above                                                   |
| `x`, `y`, `w`, `h`                                                                 | number \| `"NN%"`               | —                   | Position and size                                                           |
| `fill`                                                                             | `{ color, transparency? }`      | —                   | Fill color; `transparency` is 0–100                                         |
| `line`                                                                             | `{ color?, width?, dashType? }` | —                   | Outline; `width` in pt; `dashType`: `solid` \| `dash` \| `dot` \| `dashDot` |
| `text`                                                                             | string \| `TextSegment[]`       | —                   | Text inside the shape; array form gives rich multi-run text (below)         |
| `fontSize`, `fontFace`, `fontColor`, `charSpacing`, `bold`, `fontWeight`, `italic` | as in `text`                    | style/theme cascade | Typography for the shape's text; `fontColor` accepts semantic names         |
| `align` / `valign`                                                                 | alignment                       | — / `'top'`         | Text alignment inside the shape                                             |
| `rotate`                                                                           | number (deg)                    | —                   | Rotation                                                                    |
| `shadow`                                                                           | Shadow                          | —                   | Drop shadow (see [Shadow](#shadow))                                         |
| `rectRadius`                                                                       | number ≥ 0 (in)                 | —                   | Corner radius, only meaningful for `roundRect`                              |
| `grid`                                                                             | GridPosition                    | —                   | Grid placement                                                              |
| `style`                                                                            | string                          | —                   | Named style preset                                                          |

**`TextSegment`** — each run in the array form of `text`:

| Field                        | Type                  | Description                             |
| ---------------------------- | --------------------- | --------------------------------------- |
| `text`                       | string (**required**) | Run content                             |
| `fontSize`                   | number (pt)           | Per-run size                            |
| `fontFace`                   | string                | Per-run family                          |
| `color`                      | string                | Hex or semantic                         |
| `bold`                       | boolean               | Bold run                                |
| `fontWeight`                 | integer 100–900       | Numeric weight; same aliasing as `text` |
| `italic`                     | boolean               | Italic run                              |
| `breakLine`                  | boolean               | Line break after this run               |
| `spaceBefore` / `spaceAfter` | number (pt)           | Paragraph spacing around the run        |
| `charSpacing`                | number (pt)           | Letter spacing                          |

```json
{
  "name": "shape",
  "props": {
    "type": "roundRect",
    "rectRadius": 0.08,
    "fill": { "color": "primary", "transparency": 10 },
    "text": [
      {
        "text": "42%",
        "fontSize": 40,
        "bold": true,
        "color": "background",
        "breakLine": true
      },
      { "text": "of respondents agreed", "fontSize": 14, "color": "background" }
    ],
    "align": "center",
    "valign": "middle",
    "grid": { "column": 0, "row": 2, "columnSpan": 4, "rowSpan": 3 }
  }
}
```

---

## `table`

A data table. Cells may be plain strings or objects with per-cell formatting and spans.

| Prop                   | Type                          | Default         | Description                                                                                             |
| ---------------------- | ----------------------------- | --------------- | ------------------------------------------------------------------------------------------------------- |
| `rows`                 | `Cell[][]` (min 1 row)        | **required**    | Array of rows; each cell is a string or a Cell object (below)                                           |
| `x`, `y`, `w`, `h`     | number \| `"NN%"`             | —               | Position and size                                                                                       |
| `colW`                 | number \| number[] (in)       | —               | Uniform column width, or one width per column                                                           |
| `rowH`                 | number \| number[] (in)       | —               | Uniform row height, or one height per row                                                               |
| `border`               | `{ type?, pt?, color? }`      | —               | Cell borders; `type`: `solid` \| `dash` \| `dot` \| `none`; `pt` defaults to `1`, `color` to `'000000'` |
| `fill`                 | string                        | —               | Table background (hex or semantic)                                                                      |
| `fontSize`             | number ≥ 1 (pt)               | theme default   | Default cell font size                                                                                  |
| `fontFace`             | string                        | theme body font | Default cell font                                                                                       |
| `color`                | string                        | —               | Default cell text color                                                                                 |
| `align` / `valign`     | alignment                     | — / `'middle'`  | Default cell alignment                                                                                  |
| `autoPage`             | boolean                       | —               | Automatically continue the table on new slides when it overflows                                        |
| `autoPageRepeatHeader` | boolean                       | —               | With `autoPage`, repeat row 1 as a header on every continuation slide                                   |
| `margin`               | number \| `[t, r, b, l]` (pt) | —               | Cell inner margin                                                                                       |
| `borderRadius`         | number ≥ 0 (in)               | —               | Rounded table corners (see below)                                                                       |
| `grid`                 | GridPosition                  | —               | Grid placement                                                                                          |

**Cell object**:

| Field                                    | Type                     | Description                               |
| ---------------------------------------- | ------------------------ | ----------------------------------------- |
| `text`                                   | string (**required**)    | Cell content                              |
| `color`, `fill`                          | string                   | Per-cell text/background color            |
| `fontSize`, `fontFace`, `bold`, `italic` | as in `text`             | Per-cell typography                       |
| `fontWeight`                             | integer 100–900          | Overrides `bold`, same aliasing as `text` |
| `align` / `valign`                       | alignment                | Per-cell alignment                        |
| `colspan` / `rowspan`                    | integer ≥ 1              | Merge cells across columns/rows           |
| `margin`                                 | number \| `[t, r, b, l]` | Per-cell margin                           |

**Rounded corners** (`borderRadius`): PowerPoint tables can't natively have rounded corners, so the renderer composes them — it draws a `roundRect` and a `rect` behind the table, makes the corner cells transparent, and re-applies borders per-cell. This trick requires **numeric `x` and `y`** (not percentages; using `grid` is fine since it resolves to inches) and **at least 2 rows**.

::: info Table style neutralized
pptxgenjs applies PowerPoint's "Medium Style 2 – Accent 1" table style by default, which forces all-caps headers and banded fills. json-to-office post-processes the file to swap in "No Style, No Grid", so your cells render exactly as authored.
:::

::: tip Symbols render as text, not emoji
Glyphs that PowerPoint tends to render as color emoji (✓, ✗, ★, …) automatically get a text-presentation selector appended, so they follow your cell's font color.
:::

```json
{
  "name": "table",
  "props": {
    "rows": [
      [
        {
          "text": "Region",
          "bold": true,
          "fill": "primary",
          "color": "background"
        },
        {
          "text": "Q1",
          "bold": true,
          "fill": "primary",
          "color": "background"
        },
        { "text": "Q2", "bold": true, "fill": "primary", "color": "background" }
      ],
      ["EMEA", "1.2M", "1.4M"],
      ["APAC", "0.8M", "1.1M"],
      [{ "text": "Total", "bold": true, "colspan": 1 }, "2.0M", "2.5M"]
    ],
    "colW": [2.5, 1.5, 1.5],
    "border": { "type": "solid", "pt": 1, "color": "DDDDDD" },
    "autoPage": true,
    "autoPageRepeatHeader": true,
    "grid": { "column": 0, "row": 1, "columnSpan": 8, "rowSpan": 4 }
  }
}
```

---

## See also

- [PPTX charts](/reference/pptx/charts) — the `chart` and `highcharts` components
- [Slides & grid](/reference/pptx/slides-and-grid) — slide props, templates, placeholders, grid resolution
- [Theme schema](/reference/theme-schema) — semantic colors, style presets, component defaults
- [Fonts](/guide/fonts) — font registration and `fontWeight` variants
