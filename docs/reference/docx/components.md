# DOCX component reference

The complete catalog of DOCX components: what each one does, every prop it accepts, and a compact example. For the `docx` root and `section` containers, see the [document reference](/reference/docx/document); for a narrative introduction, see [Writing DOCX documents](/guide/writing-docx).

## Overview

| Component                                     | Category                | Children allowed                                                                              |
| --------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------- |
| [`docx`](/reference/docx/document#docx-root)  | container               | `section` only                                                                                |
| [`section`](/reference/docx/document#section) | container               | heading, paragraph, image, statistic, table, list, toc, highcharts, visual, columns, text-box |
| [`columns`](#columns)                         | layout                  | same as section, minus `columns` (no nesting)                                                 |
| [`text-box`](#text-box)                       | layout                  | heading, paragraph, image                                                                     |
| [`heading`](#heading)                         | content                 | —                                                                                             |
| [`paragraph`](#paragraph)                     | content                 | —                                                                                             |
| [`image`](#image)                             | content                 | —                                                                                             |
| [`statistic`](#statistic)                     | content                 | —                                                                                             |
| [`table`](#table)                             | content                 | — (cells nest components via `content`)                                                       |
| [`list`](#list)                               | content                 | —                                                                                             |
| [`toc`](#toc)                                 | content                 | —                                                                                             |
| [`highcharts`](#highcharts)                   | content                 | —                                                                                             |
| [`visual`](#visual)                           | content                 | —                                                                                             |
| [`text-space-after`](#text-space-after)       | plugin example (opt-in) | —                                                                                             |

Every node is `{ name, props, children? }` plus optional `id` and `enabled` fields; `enabled: false` removes the node from the render. Custom plugin components (see [API reference](/reference/api)) are allowed as children of any container.

### Units at a glance

Different Word constructs use different native units; json-to-office keeps each prop in its natural unit rather than converting behind your back.

| Where                                                         | Unit                                 |
| ------------------------------------------------------------- | ------------------------------------ |
| `spacing` (`before`/`after`), line spacing values             | points                               |
| Column widths and gaps, table cell padding/height/border size | points (or `"%"` strings)            |
| Image and text-box `width`/`height`                           | pixels (or `"%"` strings)            |
| Floating offsets, frame width/height, page margins            | twips (1/20 pt; 1440 twips = 1 inch) |
| Visual canvas                                                 | inches                               |

`Spacing` is always `{ before?, after? }` with values ≥ 0 in points (lists add an `item` field).

### Shared text features

`heading` and `paragraph` text supports inline markdown (`**bold**`, `*italic*`, `***bold italic***`, `_underscore variants_`), `\n` line breaks, `[text](url)` hyperlinks (internal bookmark links when the URL starts with `#`), and the placeholders `{PAGE}`, `{TOTAL_PAGES}`, `{DATE}`, `{DATETIME}`, `{YEAR}`. Unknown placeholders are kept as literal text. All text is Unicode NFC-normalized. Image and visual captions support the bold/italic subset.

The `font` prop, where present, is a partial font override with the same fields as a theme font definition: `family`, `size` (8–72), `color`, `bold`, `fontWeight` (100–900, wins over `bold`), `italic`, `underline`, `lineSpacing`, `spacing`, `characterSpacing` (`{ type: 'condensed' | 'expanded', value }`).

---

## `heading`

A document heading. Headings feed the [table of contents](#toc) and Word's navigation pane.

| Prop           | Type                                                                                 | Required | Default             | Description                                                           |
| -------------- | ------------------------------------------------------------------------------------ | -------- | ------------------- | --------------------------------------------------------------------- |
| `text`         | `string`                                                                             | **yes**  | —                   | Heading text (inline markdown supported)                              |
| `level`        | `1`–`6`                                                                              | no       | `1`                 | Heading level                                                         |
| `font`         | partial font object                                                                  | no       | theme               | Local font override                                                   |
| `language`     | `string` (BCP-47)                                                                    | no       | document `language` | Local proofing language                                               |
| `noProof`      | `boolean`                                                                            | no       | —                   | Disable spell/grammar check on this heading                           |
| `noProofWords` | `string[]`                                                                           | no       | —                   | Extra no-proof words, merged with the document list                   |
| `alignment`    | `'left'` \| `'center'` \| `'right'` \| `'justify'`                                   | no       | theme               |                                                                       |
| `spacing`      | `{ before?, after? }` (points)                                                       | no       | theme               |                                                                       |
| `lineSpacing`  | `number` \| `{ type: 'single'\|'atLeast'\|'exactly'\|'double'\|'multiple', value? }` | no       | theme               |                                                                       |
| `pageBreak`    | `boolean`                                                                            | no       | —                   | Page break before the heading                                         |
| `columnBreak`  | `boolean`                                                                            | no       | —                   | Column break before the heading                                       |
| `numbering`    | `boolean`                                                                            | no       | —                   | Accepted by the schema but not currently applied by the renderer      |
| `keepNext`     | `boolean`                                                                            | no       | —                   | Keep with the next paragraph                                          |
| `keepLines`    | `boolean`                                                                            | no       | —                   | Keep all lines on one page                                            |
| `revision`     | `Revision`                                                                           | no       | —                   | Tracked-change segments (see [Revisions](#revisions-tracked-changes)) |

```json
{
  "name": "heading",
  "props": { "text": "2. Methodology", "level": 2, "keepNext": true }
}
```

## `paragraph`

Body text. The workhorse component — also used inside headers, footers, table cells, and text boxes.

| Prop           | Type                                               | Required | Default             | Description                                                 |
| -------------- | -------------------------------------------------- | -------- | ------------------- | ----------------------------------------------------------- |
| `text`         | `string`                                           | **yes**  | —                   | Paragraph text (inline markdown, placeholders, hyperlinks)  |
| `font`         | partial font object                                | no       | theme               | Local font override (nested — there are no flat font props) |
| `themeStyle`   | `string`                                           | no       | —                   | Name of a style from the theme's `styles` map               |
| `language`     | `string` (BCP-47)                                  | no       | document `language` | Local proofing language                                     |
| `noProof`      | `boolean`                                          | no       | —                   | Disable proofing                                            |
| `noProofWords` | `string[]`                                         | no       | —                   | Merged with the document list                               |
| `boldColor`    | `string`                                           | no       | —                   | Color applied only to `**bold**` segments                   |
| `spacing`      | `{ before?, after? }` (points)                     | no       | theme               |                                                             |
| `alignment`    | `'left'` \| `'center'` \| `'right'` \| `'justify'` | no       | theme               |                                                             |
| `pageBreak`    | `boolean`                                          | no       | —                   | Page break before                                           |
| `columnBreak`  | `boolean`                                          | no       | —                   | Column break before                                         |
| `floating`     | frame object                                       | no       | —                   | Render as a positioned text frame (see below)               |
| `keepNext`     | `boolean`                                          | no       | —                   |                                                             |
| `keepLines`    | `boolean`                                          | no       | —                   |                                                             |
| `id`           | `string`                                           | no       | —                   | Bookmark anchor targeted by internal links `[text](#id)`    |
| `revision`     | `Revision`                                         | no       | —                   | Tracked-change segments                                     |

The `floating` frame object: `horizontalPosition` / `verticalPosition` as `{ relative: 'margin' | 'page' | 'text', align?, offset? }` (offsets in twips or `"%"` strings), `wrap.type` (`'around'` \| `'none'` \| `'notBeside'` \| `'through'` \| `'tight'` \| `'auto'`), `lockAnchor`, and `width`/`height` in twips.

```json
{
  "name": "paragraph",
  "props": {
    "id": "exec-summary",
    "text": "**Executive summary.** Revenue grew 14% — see [details](#details) or the {YEAR} filing.",
    "boldColor": "1D4ED8",
    "spacing": { "after": 8 }
  }
}
```

## `image`

An embedded picture, with optional caption and floating (anchored) placement.

| Prop               | Type                                | Required  | Default      | Description                                                                          |
| ------------------ | ----------------------------------- | --------- | ------------ | ------------------------------------------------------------------------------------ |
| `path`             | `string`                            | one of ⚠ | —            | File path or URL                                                                     |
| `base64`           | `string`                            | one of ⚠ | —            | Data URI, e.g. `data:image/png;base64,...`                                           |
| `svg`              | `string`                            | one of ⚠ | —            | Raw inline SVG markup; stays vector in Word 2016+, intrinsic size from the `viewBox` |
| `alt`              | `string`                            | no        | —            | Accessibility text                                                                   |
| `width`            | `number` (px, ≥ 1) \| `"%"` string  | no        | `'100%'`     | Percentages are relative to `widthRelativeTo`                                        |
| `height`           | `number` (px) \| `"%"` string       | no        | aspect ratio |                                                                                      |
| `widthRelativeTo`  | `'content'` \| `'page'`             | no        | `'content'`  | `content` = page width minus margins                                                 |
| `heightRelativeTo` | `'content'` \| `'page'`             | no        | `'content'`  |                                                                                      |
| `alignment`        | `'left'` \| `'center'` \| `'right'` | no        | theme        | Falls back to `'center'` when the theme sets none                                    |
| `caption`          | `string`                            | no        | —            | Supports `**bold**`, `*italic*`, `***both***`                                        |
| `spacing`          | `{ before?, after? }` (points)      | no        | —            |                                                                                      |
| `floating`         | floating object                     | no        | —            | Anchored placement (see below)                                                       |
| `keepNext`         | `boolean`                           | no        | —            |                                                                                      |
| `keepLines`        | `boolean`                           | no        | —            |                                                                                      |

::: warning One source only
Exactly one of `path`, `base64`, or `svg` must be set. Providing two is a semantic validation error (`mutually_exclusive`): _Image component accepts only one source... Use exactly one of "path", "base64", or "svg"._
:::

The `floating` object (shared with [`text-box`](#text-box)):

| Field                | Type                            | Description                                                                                                                             |
| -------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `horizontalPosition` | `{ relative, align?, offset? }` | `relative`: `character` \| `column` \| `margin` \| `page` \| `text`; `offset` in twips or `"%"`                                         |
| `verticalPosition`   | `{ relative, align?, offset? }` | `relative`: `margin` \| `page` \| `paragraph` \| `line` \| `text`                                                                       |
| `wrap`               | `{ type, side?, margins? }`     | `type`: `none` \| `square` \| `topAndBottom` \| `around` \| `tight` \| `through`; `side`: `bothSides` \| `left` \| `right` \| `largest` |
| `allowOverlap`       | `boolean`                       |                                                                                                                                         |
| `behindDocument`     | `boolean`                       | Place behind text                                                                                                                       |
| `lockAnchor`         | `boolean`                       |                                                                                                                                         |
| `layoutInCell`       | `boolean`                       |                                                                                                                                         |
| `zIndex`             | `number` (≥ 0)                  | Stacking order                                                                                                                          |
| `rotation`           | `number`                        | Degrees                                                                                                                                 |
| `visibility`         | `'hidden'` \| `'inherit'`       |                                                                                                                                         |

```json
{
  "name": "image",
  "props": {
    "svg": "<svg viewBox=\"0 0 100 40\" xmlns=\"http://www.w3.org/2000/svg\"><rect width=\"100\" height=\"40\" fill=\"#2563EB\"/></svg>",
    "width": "40%",
    "alignment": "center",
    "caption": "**Figure 3.** A vector image, crisp at any zoom."
  }
}
```

## `statistic`

A KPI card: a large number with unit, description, and an optional trend indicator. Put several in a [`columns`](#columns) block for a KPI row.

| Prop          | Type                                 | Required | Default | Description                             |
| ------------- | ------------------------------------ | -------- | ------- | --------------------------------------- |
| `number`      | `string`                             | **yes**  | —       | The headline figure                     |
| `description` | `string`                             | **yes**  | —       | What the figure measures                |
| `unit`        | `string`                             | no       | —       | e.g. `"%"`, `"€"`, `"ms"`               |
| `format`      | `string`                             | no       | —       | Number format pattern                   |
| `trend`       | `'up'` \| `'down'` \| `'neutral'`    | no       | —       | Trend direction                         |
| `trendValue`  | `string` \| `number`                 | no       | —       | Trend delta shown next to the indicator |
| `alignment`   | `'left'` \| `'center'` \| `'right'`  | no       | theme   |                                         |
| `spacing`     | `{ before?, after? }` (points)       | no       | —       |                                         |
| `size`        | `'small'` \| `'medium'` \| `'large'` | no       | —       | Card scale                              |

```json
{
  "name": "statistic",
  "props": {
    "number": "98.7",
    "unit": "%",
    "description": "Uptime last quarter",
    "trend": "up",
    "trendValue": "+0.3"
  }
}
```

## `table`

A **column-based** table: each column declares its header, width, cell defaults, and cells top-to-bottom. Cell `content` accepts a string or any nested component.

| Prop                      | Type                                                                                | Required | Default             | Description                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------- | -------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `columns`                 | `Column[]` (min 1)                                                                  | **yes**  | —                   | See the Column table below                                                                                                   |
| `borderColor`             | `string` \| `{ top?, bottom?, left?, right? }`                                      | no       | theme               | Hex without `#`                                                                                                              |
| `borderSize`              | `number` \| per-side object                                                         | no       | theme               | Points                                                                                                                       |
| `hideBorders`             | `boolean` \| `{ top?, bottom?, left?, right?, insideHorizontal?, insideVertical? }` | no       | —                   | Hide all borders or specific sides                                                                                           |
| `cellDefaults`            | `Cell` defaults object                                                              | no       | —                   | Defaults for body cells                                                                                                      |
| `headerCellDefaults`      | `Cell` defaults object                                                              | no       | —                   | Defaults for header cells                                                                                                    |
| `width`                   | `number` (0–100)                                                                    | no       | —                   | Table width as a percentage of content width                                                                                 |
| `keepInOnePage`           | `boolean`                                                                           | no       | —                   | Sets `keepNext` on all rows to avoid page splits                                                                             |
| `keepNext`                | `boolean`                                                                           | no       | `false`             | Keep the last row attached to the next element                                                                               |
| `repeatHeaderOnPageBreak` | `boolean`                                                                           | no       | `false` (effective) | Repeat the header row on every page the table spans — the header row does not repeat unless this is explicitly set to `true` |

**Column**

| Field          | Type                              | Description                                  |
| -------------- | --------------------------------- | -------------------------------------------- |
| `width`        | `number` (points) \| `"%"` string | Unspecified columns share the leftover width |
| `cellDefaults` | Cell defaults                     | Per-column cell defaults                     |
| `header`       | `Cell`                            | Header cell                                  |
| `cells`        | `Cell[]`                          | Body cells, top to bottom                    |

**Cell**

| Field                        | Type                                                          | Description                                                                                   |
| ---------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `content`                    | `string` \| component                                         | Plain text or a full nested component (image, list, columns, ...)                             |
| `color`                      | `string`                                                      | Text color. Bare hex, passed to OOXML unchanged — theme color names are **not** resolved here |
| `backgroundColor`            | `string`                                                      | Cell fill. Bare hex, passed to OOXML unchanged — theme color names are **not** resolved here  |
| `horizontalAlignment`        | `'left'` \| `'center'` \| `'right'` \| `'justify'`            |                                                                                               |
| `verticalAlignment`          | `'top'` \| `'middle'` \| `'bottom'`                           |                                                                                               |
| `font`                       | `{ family?, size?, bold?, fontWeight?, italic?, underline? }` | `fontWeight` (100–900) overrides `bold`                                                       |
| `borderColor` / `borderSize` | `string` / `number` (points)                                  | Per-cell border override                                                                      |
| `padding`                    | `number` \| `{ top?, bottom?, left?, right? }` (points)       |                                                                                               |
| `height`                     | `number` (points)                                             | Minimum row height contribution                                                               |

Note the hex conventions differ: cell `color`/`backgroundColor` hex values must be `#`-prefixed, while `borderColor` (table- and cell-level) is hex **without** `#`.

```json
{
  "name": "table",
  "props": {
    "width": 100,
    "headerCellDefaults": { "backgroundColor": "#111827", "color": "#FFFFFF" },
    "columns": [
      {
        "width": "60%",
        "header": { "content": "Milestone" },
        "cells": [{ "content": "Alpha" }, { "content": "GA" }]
      },
      {
        "header": { "content": "Date" },
        "cells": [{ "content": "May 2026" }, { "content": "Sep 2026" }]
      }
    ]
  }
}
```

## `list`

Bulleted or numbered lists with up to nine nesting levels and fully configurable numbering.

| Prop        | Type                                                | Required | Default        | Description                                                              |
| ----------- | --------------------------------------------------- | -------- | -------------- | ------------------------------------------------------------------------ |
| `items`     | `(string \| { text, level?, revision? })[]` (min 1) | **yes**  | —              | `level` is 0–8                                                           |
| `reference` | `string`                                            | no       | auto-generated | Numbering configuration ID (share it to continue numbering across lists) |
| `levels`    | `Level[]` (1–9 items)                               | no       | —              | Per-level configuration (see below)                                      |
| `format`    | LevelFormat \| `'numbered'` \| `'none'`             | no       | bullets        | Shorthand for the level-0 format                                         |
| `bullet`    | `string`                                            | no       | —              | Custom bullet character                                                  |
| `start`     | `number` (≥ 1)                                      | no       | `1`            | Level-0 starting number                                                  |
| `spacing`   | `{ before?, after?, item? }` (points)               | no       | —              | `item` = spacing between items                                           |
| `alignment` | `'left'` \| `'center'` \| `'right'` \| `'justify'`  | no       | —              |                                                                          |
| `indent`    | `number` \| `{ left?, hanging? }`                   | no       | —              |                                                                          |

**Level**

| Field       | Type                                                        | Required | Default | Description                                                                                                                                                                                                        |
| ----------- | ----------------------------------------------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `level`     | `0`–`8`                                                     | **yes**  | —       | Which nesting level this configures                                                                                                                                                                                |
| `format`    | LevelFormat                                                 | no       | —       | `decimal`, `upperRoman`, `lowerRoman`, `upperLetter`, `lowerLetter`, `bullet`, `ordinal`, `ordinalText`, `hex`, `chicago`, plus CJK/Hebrew/Arabic/Hindi/Thai formats, `none`, `numberInDash` — 60+ values in total |
| `text`      | `string`                                                    | no       | —       | Visible pattern; `%1`, `%2`, ... are the per-level counters (e.g. `"%1."`)                                                                                                                                         |
| `alignment` | `'start'` \| `'end'` \| `'left'` \| `'right'` \| `'center'` | no       | —       | Number alignment                                                                                                                                                                                                   |
| `indent`    | `{ left?, hanging? }`                                       | no       | —       | Points, converted internally (e.g. `left: 36` ≈ 0.5 in)                                                                                                                                                            |
| `start`     | `number` (≥ 1)                                              | no       | `1`     | Starting value                                                                                                                                                                                                     |

```json
{
  "name": "list",
  "props": {
    "levels": [
      { "level": 0, "format": "upperRoman", "text": "%1." },
      { "level": 1, "format": "decimal", "text": "%1.%2" }
    ],
    "spacing": { "item": 3 },
    "items": [
      "Definitions",
      { "text": "Services", "level": 1 },
      { "text": "Deliverables", "level": 1 },
      "Term and termination"
    ]
  }
}
```

## `toc`

A native Word table of contents built from headings (and optionally custom styles). Word refreshes it as a field.

| Prop                 | Type                                    | Required | Default              | Description                                                                       |
| -------------------- | --------------------------------------- | -------- | -------------------- | --------------------------------------------------------------------------------- |
| `pageBreak`          | `boolean`                               | no       | —                    | Page break before the TOC                                                         |
| `depth`              | `{ from? (1–6), to? (1–6) }`            | no       | `{ from: 1, to: 3 }` | Heading levels included                                                           |
| `pageNumbersDepth`   | same shape                              | no       | —                    | Which levels show page numbers                                                    |
| `numberingStyle`     | `'numeric'` \| `'bullet'` \| `'none'`   | no       | —                    | Accepted but not applied — the underlying `docx` TOC API has no equivalent option |
| `title`              | `string`                                | no       | —                    | TOC heading                                                                       |
| `includePageNumbers` | `boolean`                               | no       | `true`               |                                                                                   |
| `numberSeparator`    | `boolean`                               | no       | `true`               | `true` = tab before the page number, `false` = space                              |
| `scope`              | `'document'` \| `'section'` \| `'auto'` | no       | `'auto'`             | `auto` = section-scoped when inside a section, else document-wide                 |
| `styles`             | `{ styleId: string, level: 1–6 }[]`     | no       | —                    | Map custom theme styles into TOC levels                                           |

```json
{
  "name": "toc",
  "props": { "title": "Contents", "depth": { "to": 2 }, "pageBreak": true }
}
```

## `columns`

Side-by-side column layout. Each child fills the next column. Allowed children: everything a section allows except another `columns`.

| Prop      | Type                                   | Required | Default            | Description                                  |
| --------- | -------------------------------------- | -------- | ------------------ | -------------------------------------------- |
| `columns` | `number` (≥ 1) \| `ColumnDescriptor[]` | **yes**  | —                  | A number gives that many equal-width columns |
| `gap`     | `number` (points) \| `"%"` string      | no       | 720 twips (0.5 in) | Gap after each column except the last        |

**ColumnDescriptor**: `width?` (`number` in points, `"%"` string, or `'auto'` for remaining space) and `gap?` (points or `"%"`). Percentages are relative to the available content width.

```json
{
  "name": "columns",
  "props": { "columns": [{ "width": "30%" }, { "width": "auto" }], "gap": 18 },
  "children": [
    { "name": "image", "props": { "path": "./logo.png", "width": "100%" } },
    {
      "name": "paragraph",
      "props": { "text": "Company profile text flows in the wide column." }
    }
  ]
}
```

::: info
Inside a `text-box`, a nested `columns` renders as a multi-column table.
:::

## `text-box`

A bordered, padded box — callouts, sidebars, cover-page blocks. Allowed children: `heading`, `paragraph`, `image`.

| Prop            | Type                                                                                | Required | Default | Description                                                                                               |
| --------------- | ----------------------------------------------------------------------------------- | -------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `width`         | `number` (px, ≥ 1) \| `"%"` string                                                  | no       | —       | Relative to content width                                                                                 |
| `height`        | `number` (px, ≥ 1) \| `"%"` string                                                  | no       | —       |                                                                                                           |
| `floating`      | floating object                                                                     | no       | —       | Identical schema to [`image`](#image) — one shared floating schema for both components                    |
| `style.padding` | `{ top?, right?, bottom?, left? }` (≥ 0)                                            | no       | —       | Inner padding                                                                                             |
| `style.border`  | per-side `{ style: 'solid'\|'dashed'\|'dotted'\|'double'\|'none', width?, color? }` | no       | —       | `color` takes `#`-prefixed hex or a theme color name                                                      |
| `style.shading` | `{ fill?: string }`                                                                 | no       | —       | Background fill. `fill` takes `#`-prefixed hex or a theme color name — a bare hex string throws at render |

```json
{
  "name": "text-box",
  "props": {
    "width": "45%",
    "style": {
      "padding": { "top": 6, "right": 8, "bottom": 6, "left": 8 },
      "border": {
        "left": { "style": "solid", "width": 3, "color": "#16A34A" }
      },
      "shading": { "fill": "#F0FDF4" }
    }
  },
  "children": [
    {
      "name": "paragraph",
      "props": { "text": "**Note.** Figures exclude one-off items." }
    }
  ]
}
```

## `highcharts`

Renders a chart through a Highcharts export server and embeds the result as an image. Requires a Node.js environment and a reachable export server (or the `services.highcharts` generation option). See [Charts](/guide/charts).

| Prop               | Type                          | Required | Default                 | Description                                                                                                                                     |
| ------------------ | ----------------------------- | -------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `options`          | Highcharts config object      | **yes**  | —                       | Passed to the export server verbatim; `chart.width` and `chart.height` (numbers) are mandatory                                                  |
| `scale`            | `number`                      | no       | —                       | Export scale factor (higher = sharper raster)                                                                                                   |
| `resources`        | `{ css?, js?, files? }`       | no       | —                       | Forwarded to the export server; enables custom `@font-face`, plugins                                                                            |
| `serverUrl`        | `string`                      | no       | `http://localhost:7801` | Export server URL override; takes precedence over the `services.highcharts` config, which in turn overrides the default `http://localhost:7801` |
| `width` / `height` | `number` (px) \| `"%"` string | no       | —                       | Rendered image size in the document                                                                                                             |

```json
{
  "name": "highcharts",
  "props": {
    "width": "85%",
    "options": {
      "chart": { "type": "column", "width": 900, "height": 500 },
      "title": { "text": "Revenue by quarter" },
      "xAxis": { "categories": ["Q1", "Q2", "Q3", "Q4"] },
      "series": [{ "name": "2026", "data": [120, 132, 145, 160] }]
    }
  }
}
```

## `visual`

A free-canvas graphic authored as a **single PPTX slide** — text, shapes, images, tables, and charts positioned in inches — rasterized to a PNG by a PPTX rendering service and placed like an [`image`](#image). This gives Word documents the full expressiveness of the slide engine; see the [PPTX component reference](/reference/pptx/components) for the element types.

| Prop                                              | Type                                | Required | Default                          | Description                                                                                                                                        |
| ------------------------------------------------- | ----------------------------------- | -------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `canvas`                                          | object                              | **yes**  | —                                | `{ width, height }` in **inches** (each ≥ 0.1), optional `theme` (a PPTX theme name) and `background` (`{ color?, image?: { path? \| base64? } }`) |
| `elements`                                        | PPTX slide-content array            | no       | —                                | The real PPTX slide-content union: `text`, `image`, `shape`, `table`, `highcharts`, `chart` nodes with `x`/`y`/`w`/`h` in inches                   |
| `dpi`                                             | `number` (36–600)                   | no       | `200`                            | Raster resolution; out-of-range values fail validation (the render-time clamp applies only to unvalidated inputs like `services.pptx.dpi`)         |
| `serverUrl`                                       | `string`                            | no       | `http://localhost:7802`          | Rasterization service URL; an in-process `services.pptx.render` callback takes precedence                                                          |
| `width` / `height`                                | `number` (px) \| `"%"` string       | no       | `width`: canvas size at 96 px/in | `width` defaults to the canvas physical size; `height` is left unset so the rendered PNG's aspect ratio is preserved                               |
| `alignment`                                       | `'left'` \| `'center'` \| `'right'` | no       | `'center'`                       |                                                                                                                                                    |
| `caption`                                         | `string`                            | no       | —                                | Rich text (bold/italic)                                                                                                                            |
| `alt`                                             | `string`                            | no       | —                                | Accessibility text                                                                                                                                 |
| `spacing` / `floating` / `keepNext` / `keepLines` | as `image`                          | no       | —                                |                                                                                                                                                    |

At render time the visual becomes a one-slide presentation `{ name: 'pptx', ... }` and is POSTed to the service's `/rasterize` endpoint as `{ presentation, dpi }`; the response `{ base64DataUri, width, height }` is embedded as an image. If the service is unreachable, the error suggests configuring `services.pptx`.

```json
{
  "name": "visual",
  "props": {
    "alignment": "center",
    "caption": "**Figure 1.** Authored as a pptx slide, embedded as an image.",
    "canvas": {
      "width": 7.2,
      "height": 2.6,
      "background": { "color": "F4F8FF" }
    },
    "elements": [
      {
        "name": "shape",
        "props": {
          "type": "chevron",
          "x": 0.3,
          "y": 0.7,
          "w": 2.0,
          "h": 1.2,
          "fill": { "color": "BBD3FF" }
        }
      }
    ]
  }
}
```

::: tip Offline documents
`flattenVisuals(doc, { rasterize, dpi?, concurrency? })` pre-renders every enabled `visual` into a plain base64 `image` node — including visuals inside section headers/footers and table cells — producing a portable `.docx.json` that renders with no services configured. Disabled visuals (`enabled: false`) are left untouched. See the [API reference](/reference/api).
:::

## `text-space-after`

An **example plugin component**, not part of the standard registry: a document using it fails default validation (`unknown_component`) and the stock renderer rejects it. It ships as a reference implementation of the plugin component API (`packages/core-docx/src/plugin/example/text-space-after.component.ts`) and must be registered on a custom generator before use:

```ts
const generator = createDocumentGenerator({}).addComponent(
  textSpaceAfterComponent
);
```

Once registered, it takes `{ text: string, spaceAfter?: number }` — the text to display and the trailing space in points — and renders as a paragraph with that `spacing.after`. See the plugin API in the [API reference](/reference/api).

## Revisions (tracked changes)

`heading`, `paragraph`, and individual `list` items can carry a `revision` prop describing word-level edits, rendered as native Word tracked changes (`w:ins`/`w:del`). The [diff engine](/guide/writing-docx#tracked-changes-diffing-two-documents) generates these automatically; you can also author them by hand.

**Revision**

| Field      | Type                | Required | Default                               | Description                 |
| ---------- | ------------------- | -------- | ------------------------------------- | --------------------------- |
| `author`   | `string`            | no       | `"json-to-office"`                    | Shown in Word's review pane |
| `date`     | `string` (ISO 8601) | no       | Unix epoch (for deterministic output) | Revision timestamp          |
| `segments` | `Segment[]` (min 1) | **yes**  | —                                     | The edit sequence           |

**Segment**: `{ type: 'equal' | 'insert' | 'delete', text: string }`. Segments are concatenated in order — `equal` text is untouched, `insert` renders as an insertion, `delete` as a struck-through deletion.

```json
{
  "name": "paragraph",
  "props": {
    "text": "Payment is due within 30 days.",
    "revision": {
      "author": "Legal team",
      "date": "2026-06-09T10:00:00Z",
      "segments": [
        { "type": "equal", "text": "Payment is due within " },
        { "type": "delete", "text": "45" },
        { "type": "insert", "text": "30" },
        { "type": "equal", "text": " days." }
      ]
    }
  }
}
```

Set `trackRevisions: true` on the [`docx` root](/reference/docx/document#docx-root) to open the document with track-changes mode active (redlines produced by `diffDocuments` do this automatically). `revision` is deliberately excluded from `componentDefaults` — revisions describe specific edits and cannot be defaulted.
