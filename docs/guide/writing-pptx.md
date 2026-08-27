# Writing PPTX documents

A json-to-office presentation is a single JSON tree: a `pptx` root that holds presentation-wide settings, a list of `slide` children, and content components (text, images, shapes, tables, charts) inside each slide. This page walks through authoring that tree from an empty skeleton to a templated, self-contained deck — for exhaustive prop tables, follow the links into the [reference](/reference/pptx/presentation).

## The presentation skeleton

Every document starts with a root component named `pptx`. Its `props` carry metadata and global configuration; its `children` are the slides, in order. Slides in turn contain the visible content:

```json
{
  "name": "pptx",
  "props": {
    "title": "Q3 Business Review",
    "author": "Jane Doe",
    "company": "Acme Inc.",
    "theme": "default"
  },
  "children": [
    {
      "name": "slide",
      "children": [
        {
          "name": "text",
          "props": { "text": "Q3 Business Review", "style": "title" }
        }
      ]
    }
  ]
}
```

Every component in the tree has the same shape: `{ "name": ..., "props": ..., "children": ... }` plus optional `id` and `enabled` fields. The slide above carries no `props` at all, which is legal: `slide` is the one component whose props are entirely optional, so the key can go. Everywhere else — the root included — `props` is where the component's content lives and validation asks for it. Setting `enabled: false` removes a component from the output without deleting it from your JSON — handy for toggling elements on and off while iterating. It works the same way on **slides**: a slide marked `enabled: false` is not emitted at all, and the slides after it move up. Omitting `enabled` means enabled; only the explicit value `false` drops a component.

The root may only contain `slide` children, and slides may only contain the six content components: `text`, `image`, `shape`, `table`, `chart`, and `highcharts`. Content components are leaves — they never have children of their own.

## Slide size

Slides default to the classic 4:3 format, **10 × 7.5 inches**. For a widescreen 16:9 deck — the right choice for almost anything shown on a modern screen — set `slideWidth` to 13.33:

```json
{
  "name": "pptx",
  "props": {
    "title": "Widescreen deck",
    "slideWidth": 13.33,
    "slideHeight": 7.5
  },
  "children": []
}
```

Everywhere a position or size appears in a document, a plain number means **inches** and a string like `"50%"` means a percentage of the slide dimension.

## Placing content with the grid

You can position anything with explicit `x`/`y`/`w`/`h` coordinates, but hand-placing boxes in inches gets tedious and fragile fast. The grid system is the recommended alternative: the slide is divided into columns and rows (by default **12 columns × 6 rows**, with a 0.5 in margin on all sides and 0.2 in gutters), and each component declares which cells it occupies:

```json
{
  "name": "slide",
  "children": [
    {
      "name": "text",
      "props": {
        "text": "Revenue by quarter",
        "style": "heading1",
        "grid": { "column": 0, "row": 0, "columnSpan": 12, "rowSpan": 1 }
      }
    },
    {
      "name": "chart",
      "props": {
        "type": "bar",
        "data": [
          {
            "name": "Revenue",
            "labels": ["Q1", "Q2", "Q3"],
            "values": [120, 145, 168]
          }
        ],
        "grid": { "column": 0, "row": 1, "columnSpan": 8, "rowSpan": 5 }
      }
    },
    {
      "name": "text",
      "props": {
        "text": "Q3 grew 16% quarter over quarter, driven by the enterprise tier.",
        "style": "body",
        "grid": { "column": 8, "row": 1, "columnSpan": 4, "rowSpan": 5 }
      }
    }
  ]
}
```

`column` and `row` are **0-indexed**; spans default to 1. The library resolves each grid placement to concrete inches at generation time, so the same layout logic adapts automatically if you change the slide size or grid configuration. You can customize the grid per presentation (and per template) via the root `grid` prop — for example the bundled Company deck uses a 12 × 12 grid with tighter 0.16 in gutters for finer vertical control.

The full resolution math, clamping behavior, and explicit-coordinate overrides are covered in [Slides & the grid](/reference/pptx/slides-and-grid).

## Text and style presets

Rather than repeating font sizes and colors on every text box, use the seven named style presets that every theme defines: `title`, `subtitle`, `heading1`, `heading2`, `heading3`, `body`, and `caption`. The built-in themes ship with sensible defaults — `title` is 36 pt bold centered, `heading1` is 28 pt bold in the primary color, `body` is 14 pt, `caption` is 10 pt italic in the secondary text color — and `title`/`heading*` styles automatically use the theme's heading font while the rest use the body font.

```json
{
  "name": "slide",
  "children": [
    {
      "name": "text",
      "props": {
        "text": "Our approach",
        "style": "title",
        "grid": { "column": 0, "row": 1, "columnSpan": 12, "rowSpan": 2 }
      }
    },
    {
      "name": "text",
      "props": {
        "text": "Three principles that guide every decision",
        "style": "subtitle",
        "grid": { "column": 0, "row": 3, "columnSpan": 12 }
      }
    }
  ]
}
```

Any prop you set directly on the component wins over the style, which in turn wins over the theme defaults. So `{ "style": "body", "fontSize": 16, "color": "accent" }` gives you the body preset with a bumped size and a theme accent color. Colors accept hex values (`"#1A73E8"`) or semantic theme names (`primary`, `secondary`, `accent`, `background`, `text`, `text2`, `background2`, `accent4`–`accent6`) — semantic names are the better default because they keep the deck retargetable to any theme. See [Themes & styling](/guide/themes) for how presets and the color system fit together, and [Fonts](/guide/fonts) for font resolution.

Text also supports bullets, hyperlinks, rich formatting, and two page-numbering placeholders — `{PAGE_NUMBER}` and `{PAGE_COUNT}` — that are substituted per slide at generation time (zero-padded if the root sets `"pageNumberFormat": "09"`).

## Shapes, images, and tables

The other content components follow the same pattern — a `name`, positioning (grid or explicit), and type-specific props:

```json
{
  "name": "slide",
  "children": [
    {
      "name": "shape",
      "props": {
        "type": "roundRect",
        "fill": { "color": "primary", "transparency": 90 },
        "rectRadius": 0.1,
        "grid": { "column": 0, "row": 1, "columnSpan": 4, "rowSpan": 3 }
      }
    },
    {
      "name": "image",
      "props": {
        "path": "https://example.com/product.png",
        "sizing": { "type": "contain" },
        "alt": "Product screenshot",
        "grid": { "column": 4, "row": 1, "columnSpan": 4, "rowSpan": 3 }
      }
    },
    {
      "name": "table",
      "props": {
        "rows": [
          [
            { "text": "Metric", "bold": true },
            { "text": "Value", "bold": true }
          ],
          ["Active users", "48,200"],
          ["NPS", "62"]
        ],
        "grid": { "column": 8, "row": 1, "columnSpan": 4, "rowSpan": 3 }
      }
    }
  ]
}
```

- **Shapes** come in 15 types (`rect`, `roundRect`, `ellipse`, `arrow`, `star5`, ...) and can carry text — including multi-run rich text segments with per-run fonts and weights.
- **Images** take exactly one source: a `path` (file or URL), a `base64` data string, or raw inline `svg` markup (embedded as a true vector). If you give only a width or only a height, the other dimension is computed from the image's intrinsic aspect ratio.
- **Tables** accept simple strings or rich cell objects with per-cell fill, font, alignment, `colspan`/`rowspan`, and support auto-pagination across slides with repeated headers.

Charts get a walkthrough of their own in [Charts](/guide/charts) — the native `chart` component covers 9 editable PowerPoint chart types, and `highcharts` rasterizes a full Highcharts config via an export server. Full prop tables for every component live in the [PPTX component reference](/reference/pptx/components) and [chart reference](/reference/pptx/charts).

## Speaker notes and hidden slides

Slides carry presentation logistics in their own props. `notes` becomes the speaker notes visible in presenter view, and `hidden: true` keeps a slide in the file but skips it during the slideshow — useful for appendix or backup slides:

```json
{
  "name": "slide",
  "props": {
    "notes": "Pause here — ask the room about their current tooling before advancing.",
    "hidden": false
  },
  "children": []
}
```

`hidden: true` and `enabled: false` are different tools: a hidden slide ships in the `.pptx` and is only skipped while presenting, whereas a disabled slide never reaches the file at all. Dropping a slide has two knock-on effects worth knowing before you toggle one off mid-deck:

- **Numbering is computed after the drop.** `{PAGE_NUMBER}` / `{PAGE_COUNT}` and PowerPoint's own slide numbers count only the slides that were emitted — a three-slide deck with the middle slide disabled renders as `1/2` and `2/2`.
- **Internal links follow the slide they point at.** `hyperlink.slide` on `text` and `image` is a 1-based index over the slides _as written in the JSON_, disabled ones included, and generation rebases it onto the emitted numbering — so a link to the third slide you authored still reaches that slide's content after an earlier slide is switched off. A link whose own target is disabled, or whose index falls outside the authored range, cannot be honored: it is dropped, the `text` or `image` renders without a link, and generation reports a `HYPERLINK_SLIDE_UNRESOLVED` warning. Previously such a link was written as a relationship to a `slideN.xml` part that is not in the file, which PowerPoint reports as damaged and offers to repair.

## Backgrounds

Each slide can set a background color (hex or semantic theme name) or a background image:

```json
{ "name": "slide", "props": { "background": { "color": "primary" } } }
```

```json
{
  "name": "slide",
  "props": { "background": { "image": { "path": "./assets/cover.jpg" } } }
}
```

Using semantic colors for backgrounds (`"background"`, `"primary"`, `"background2"`) keeps dark-section slides consistent when you swap themes.

## Templates and placeholders

Once a deck has more than a few slides, you will notice the same layouts repeating: a cover, section dividers, a two-column content slide. Templates let you define each layout **once**, at the root, and stamp it onto any number of slides. A template bundles a background, fixed decorations (`objects` — logos, footers, decorative shapes), and named `placeholders`: regions with a position and styling defaults, waiting for content.

```json
{
  "name": "pptx",
  "props": {
    "title": "Company deck",
    "slideWidth": 13.33,
    "slideHeight": 7.5,
    "grid": { "columns": 12, "rows": 12 },
    "templates": [
      {
        "name": "COVER_TEMPLATE",
        "background": { "color": "primary" },
        "objects": [
          {
            "name": "image",
            "props": {
              "path": "https://example.com/logo-white.svg",
              "w": "7.5%",
              "h": "2.8%",
              "grid": { "column": 0, "row": 0 }
            }
          }
        ],
        "placeholders": [
          {
            "name": "title",
            "grid": { "column": 0, "row": 3, "columnSpan": 10, "rowSpan": 5 },
            "defaults": {
              "name": "text",
              "props": {
                "style": "title",
                "color": "background",
                "valign": "bottom"
              }
            }
          },
          {
            "name": "subtitle",
            "grid": { "column": 0, "row": 9, "columnSpan": 7, "rowSpan": 2 },
            "defaults": {
              "name": "text",
              "props": {
                "style": "subtitle",
                "fontSize": 16,
                "color": "#9A9EB0"
              }
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
        "template": "COVER_TEMPLATE",
        "notes": "Cover slide.",
        "placeholders": {
          "title": {
            "name": "text",
            "props": { "text": "A showcase of the 16:9\nslide system" }
          },
          "subtitle": {
            "name": "text",
            "props": { "text": "Mock deck illustrating every template" }
          }
        }
      }
    }
  ]
}
```

The slide only supplies **content**; position and styling come from the placeholder definition. This is the core of the "documents as data" idea — an LLM or a script can fill placeholders on a well-designed template without ever touching layout. Templates can even override the grid configuration for their slides. The complete template and placeholder model — including the defaults precedence chain — is documented in [Slides & the grid](/reference/pptx/slides-and-grid).

## Inline themes: self-contained decks

The root `theme` prop normally names a built-in theme (`default`, `dark`, `minimal`) or a custom theme registered via generation options. But it can also be a **full theme object inline**, which makes the JSON document completely self-contained — no external theme file, no registration code, one artifact you can store, diff, and ship:

```json
{
  "name": "pptx",
  "props": {
    "theme": {
      "name": "brand",
      "colors": {
        "primary": "#1A2B4C",
        "secondary": "#4C6EF5",
        "accent": "#12B886",
        "background": "#FFFFFF",
        "text": "#1A1A2E"
      },
      "fonts": { "heading": "Georgia", "body": "Arial" },
      "defaults": { "fontSize": 14, "fontColor": "#1A1A2E" }
    }
  },
  "children": []
}
```

At generation time the inline object is normalized into a named custom theme, so everything downstream — semantic colors, style presets, chart palettes — behaves exactly as with a named theme. See the [theme schema reference](/reference/theme-schema) for every field.

## Generating, and reading the warnings

Bring the document to life with the library API (or the [CLI](/guide/cli) / [playground](/guide/playground)):

```ts
import { generateBufferWithWarnings } from '@json-to-office/json-to-pptx';
import { writeFile } from 'node:fs/promises';

const { buffer, warnings } = await generateBufferWithWarnings(document);
await writeFile('deck.pptx', buffer);

for (const w of warnings) {
  console.warn(`[${w.code}] ${w.message}`);
}
```

Generation is forgiving about recoverable content problems: instead of failing on them, it emits **pipeline warnings** and produces the best file it can. Each warning has a machine-readable `code` — for example `GRID_POSITION_CLAMPED` (a grid placement fell outside the grid and was clamped), `MISSING_TEMPLATE` (a slide referenced a template name that doesn't exist), `HYPERLINK_SLIDE_UNRESOLVED` (an internal link pointed at no emitted slide and was dropped), `IMAGE_NO_SOURCE`, `CHART_INVALID_SERIES`, `THEME_COLOR_FALLBACK`, or `FONT_UNRESOLVED` — and, where available, the component and/or slide it came from.

::: tip Schema errors fail before any of this
Generation validates the document against the schema first, so a wrong prop name or invalid nesting throws `PresentationValidationError` rather than reaching the warning path. Warnings only cover what the schema can't express. `validate.document(...)` and `jto pptx validate` run the same check without producing a file. See [Validation](/guide/validation).

The other hard failures at generation time: an image with more than one source (`path` / `base64` / `svg` are mutually exclusive), a `text` carrying both `text` and `runs`, and `highcharts` errors (unreachable export server, or running in a browser).
:::

## Where to go next

- [Presentation & slide reference](/reference/pptx/presentation) — every root and slide prop.
- [Slides & the grid](/reference/pptx/slides-and-grid) — grid math, templates, placeholders.
- [PPTX components](/reference/pptx/components) — full prop tables for text, image, shape, table.
- [Charts](/guide/charts) — native charts vs. Highcharts.
- [Themes & styling](/guide/themes) — the color system and style presets.
- [Examples](/examples/) — complete decks to copy from.
