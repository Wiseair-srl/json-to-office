# DOCX component reference

The complete catalog of DOCX components: what each one does, every prop it accepts, and a compact example. For the `docx` root and `section` containers, see the [document reference](/reference/docx/document); for a narrative introduction, see [Writing DOCX documents](/guide/writing-docx).

## Overview

| Component                                     | Category                | Children allowed                                                                                     |
| --------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| [`docx`](/reference/docx/document#docx-root)  | container               | `section` only                                                                                       |
| [`section`](/reference/docx/document#section) | container               | heading, paragraph, image, statistic, table, list, toc, highcharts, chart, visual, columns, text-box |
| [`columns`](#columns)                         | layout                  | same as section, minus `columns` (no nesting)                                                        |
| [`text-box`](#text-box)                       | layout                  | heading, paragraph, image                                                                            |
| [`heading`](#heading)                         | content                 | —                                                                                                    |
| [`paragraph`](#paragraph)                     | content                 | —                                                                                                    |
| [`image`](#image)                             | content                 | —                                                                                                    |
| [`statistic`](#statistic)                     | content                 | —                                                                                                    |
| [`table`](#table)                             | content                 | — (cells nest components via `content`)                                                              |
| [`list`](#list)                               | content                 | —                                                                                                    |
| [`toc`](#toc)                                 | content                 | —                                                                                                    |
| [`highcharts`](#highcharts)                   | content                 | —                                                                                                    |
| [`chart`](#chart)                             | content (`office-open`) | —                                                                                                    |
| [`visual`](#visual)                           | content                 | —                                                                                                    |
| [`text-space-after`](#text-space-after)       | plugin example (opt-in) | —                                                                                                    |

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

`heading` and `paragraph` text supports inline markdown (`**bold**`, `*italic*`, `***bold italic***`, `_underscore variants_`), `\n` line breaks, `[text](url)` hyperlinks (internal bookmark links when the URL starts with `#`), `[@id]` cross-references (below), and the placeholders `{PAGE}`, `{TOTAL_PAGES}`, `{DATE}`, `{DATETIME}`, `{YEAR}`. Unknown placeholders are kept as literal text. All text is Unicode NFC-normalized. Image and visual captions support the bold/italic subset.

#### Cross-references

`[@id]` inserts a Word `REF` field pointing at a [numbered heading](#heading-numbering) or a [list item](#list) that declares an `id`. It renders as the target's number and hyperlinks to it, so the number follows the target when sections are reordered.

| Token                | Word switch | Renders                                                     |
| -------------------- | ----------- | ----------------------------------------------------------- |
| `[@id]`              | `\r`        | The number relative to where the reference sits (default)   |
| `[@id:no_context]`   | `\n`        | Only the target's own level counter — `3` for heading 2.1.3 |
| `[@id:full_context]` | `\w`        | The whole number — `2.1.3`                                  |
| `[@id:none]`         | —           | The target's text instead of its number                     |

A heading's `id` is its explicit node `id` if it has one, otherwise a slug of its text (`"Data Sources"` → `data-sources`, disambiguated with `-1`, `-2` on collision). List items take the `id` written on the item.

A reference renders the bare number — `1.1` — while the heading itself renders `1.1.`: the trailing period belongs to the heading's numbering, and Word's reference switches drop it.

```json
[
  {
    "name": "heading",
    "props": { "text": "Field study", "level": 1, "numbering": true }
  },
  {
    "name": "heading",
    "id": "methods",
    "props": { "text": "Methods", "level": 2, "numbering": true }
  },
  {
    "name": "paragraph",
    "props": {
      "text": "Sampling is described in [@methods] ([@methods:none])."
    }
  }
]
```

"Field study" is the document's first level-1 heading, so it numbers `1.` and "Methods" numbers `1.1.` — the paragraph renders as "Sampling is described in 1.1 (Methods)."

Two caveats:

- **The number is cached at generation time.** Word recomputes every field on open (the document sets `updateFields`), but headless LibreOffice — and therefore the PDF export — shows the cached value, so a `[@id]` in a PDF reflects the document as generated. `[@id]` (relative) is the approximation: its true value depends on where the reference sits, which only Word resolves.
- **A reference the pre-pass cannot resolve degrades rather than breaking.** An unknown id renders as the literal `[@id]` text with a warning — never as Word's "Error! Reference source not found". A target that exists but carries no number (a bullet-list item, an unnumbered heading) gets a real field with no cached value: blank until the reader updates fields, and a warning suggesting `:none`.

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
| `numbering`    | `boolean`                                                                            | no       | —                   | Auto-number this heading (see below)                                  |
| `keepNext`     | `boolean`                                                                            | no       | —                   | Keep with the next paragraph                                          |
| `keepLines`    | `boolean`                                                                            | no       | —                   | Keep all lines on one page                                            |
| `revision`     | `Revision`                                                                           | no       | —                   | Tracked-change segments (see [Revisions](#revisions-tracked-changes)) |
| `comment`      | `Comment`                                                                            | no       | —                   | Review comment (see [Comments](#comments))                            |

```json
{
  "name": "heading",
  "props": { "text": "Methodology", "level": 2, "keepNext": true }
}
```

### Heading numbering

`numbering: true` puts the heading in the document's multilevel heading numbering — `1.`, `1.1.`, `1.1.1.`, one continuous sequence across the whole document, with the number rendered by Word rather than typed into `text`. The definition binds each level to the matching `Heading1`–`Heading6` style, so Word's own "Continue numbering" UI, the TOC refresh, and `[@id]` cross-references all agree with it.

Turn it on for the whole document through the theme's `componentDefaults.heading.numbering`, and set `numbering: false` on a single heading to opt that one out (an unnumbered appendix title, say). A heading whose level appears before any heading of the level above it numbers with zeros — `2.0.1` — exactly as Word does.

Only numbered headings advance the counters: an unnumbered heading in the middle of a numbered document does not consume a number.

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
| `comment`      | `Comment`                                          | no       | —                   | Review comment (see [Comments](#comments))                  |
| `footnotes`    | `Note[]` (min 1)                                   | no       | —                   | Footnote bodies for the `[^id]` markers in `text`           |
| `endnotes`     | `Note[]` (min 1)                                   | no       | —                   | Endnote bodies for the `[^id]` markers in `text`            |

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

| Prop                      | Type                                                                                | Required | Default | Description                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------- | -------- | ------- | ---------------------------------------------------------------------------------- |
| `columns`                 | `Column[]` (min 1)                                                                  | **yes**  | —       | See the Column table below                                                         |
| `rows`                    | `Row[]`                                                                             | no       | —       | Row-parallel properties, indexed like `cells` (see [Table rows](#table-rows))      |
| `borderColor`             | `string` \| `{ top?, bottom?, left?, right? }`                                      | no       | theme   | Hex without `#`                                                                    |
| `borderSize`              | `number` \| per-side object                                                         | no       | theme   | Points                                                                             |
| `hideBorders`             | `boolean` \| `{ top?, bottom?, left?, right?, insideHorizontal?, insideVertical? }` | no       | —       | Hide all borders or specific sides                                                 |
| `cellDefaults`            | `Cell` defaults object                                                              | no       | —       | Defaults for body cells                                                            |
| `headerCellDefaults`      | `Cell` defaults object                                                              | no       | —       | Defaults for header cells                                                          |
| `width`                   | `number` (0–100)                                                                    | no       | —       | Table width as a percentage of content width                                       |
| `keepInOnePage`           | `boolean`                                                                           | no       | —       | Sets `keepNext` on all rows to avoid page splits                                   |
| `keepNext`                | `boolean`                                                                           | no       | `false` | Keep the last row attached to the next element                                     |
| `repeatHeaderOnPageBreak` | `boolean`                                                                           | no       | `true`  | Repeat the header row on every page the table spans — set it to `false` to opt out |

::: warning Header rows repeat by default
The header row emits `<w:tblHeader/>` unless `repeatHeaderOnPageBreak` is explicitly `false`. This changes how existing multi-page tables render: a table that spans a page break now repeats its header on every page instead of showing it once. Pass `"repeatHeaderOnPageBreak": false` to keep the header on the first page only.
:::

**Column**

| Field          | Type                              | Description                                  |
| -------------- | --------------------------------- | -------------------------------------------- |
| `width`        | `number` (points) \| `"%"` string | Unspecified columns share the leftover width |
| `cellDefaults` | Cell defaults                     | Per-column cell defaults                     |
| `header`       | `Cell`                            | Header cell                                  |
| `cells`        | `Cell[]`                          | Body cells, top to bottom                    |

**Cell**

| Field                        | Type                                                          | Description                                                                                |
| ---------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `content`                    | `string` \| component                                         | Plain text or a full nested component (image, list, columns, ...)                          |
| `color`                      | `string`                                                      | Text color. `#`-prefixed hex, a theme color name, or `"auto"`                              |
| `backgroundColor`            | `string`                                                      | Cell fill. Same values as `color`, plus `"transparent"` to leave the cell unshaded         |
| `horizontalAlignment`        | `'left'` \| `'center'` \| `'right'` \| `'justify'`            |                                                                                            |
| `verticalAlignment`          | `'top'` \| `'middle'` \| `'bottom'`                           |                                                                                            |
| `font`                       | `{ family?, size?, bold?, fontWeight?, italic?, underline? }` | `fontWeight` (100–900) overrides `bold`                                                    |
| `borderColor` / `borderSize` | `string` / `number` (points)                                  | Per-cell border override                                                                   |
| `padding`                    | `number` \| `{ top?, bottom?, left?, right? }` (points)       |                                                                                            |
| `height`                     | `number` (points)                                             | Minimum row height contribution                                                            |
| `comment`                    | `Comment`                                                     | Review comment wrapping the cell's content (see [Comments](#comments))                     |
| `revision`                   | `Revision`                                                    | Word-level tracked change on the cell's text (see [Revisions](#revisions-tracked-changes)) |

Cell `color` and `backgroundColor` are resolved the same way paragraph and heading `font.color` are: `#RRGGBB` is normalized to bare uppercase hex, and a theme color name (`primary`, `accent`, `text`, ...) resolves to that theme's value. A bare hex without `#` still works for backwards compatibility, but only when it starts with a letter (`F0FDF4`) — a digit-leading one such as `0F0FDF` fails validation, because the shared color pattern accepts only `#RRGGBB` or an identifier.

`"auto"` is accepted on both props and passed through to OOXML unchanged (`w:fill="auto"` / `w:val="auto"`) — it is the one non-hex keyword Word itself understands.

`"transparent"` is a **`backgroundColor`-only** sentinel: it suppresses the `w:shd` element so the cell stays unshaded. On `color` there is nothing to suppress and no legal `w:color` value to emit, so it is dropped with a `TABLE_CELL_COLOR_INVALID` warning on stderr and the cell's text takes the table style's color instead. The warning is deduplicated per table, so a whole column of `"transparent"` cells reports once.

Anything else the theme cannot resolve **aborts generation** with a message naming the prop — for example _Invalid table cell color: "accnet". Must be a hex color with # prefix (e.g. "#000000"), a theme color name, or "auto"._ (the `backgroundColor` variant ends `..., "auto", or "transparent" for no shading.`). Failing here is deliberate: the underlying `docx` library rejects every non-hex, non-`"auto"` fill and color value anyway, so passing the value through would fail all the same, deeper down and with an opaque message.

Note the conventions differ between the two color families: `borderColor` (table- and cell-level) is hex **without** `#`, passed to OOXML unchanged, and theme color names are **not** resolved there.

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

| Prop        | Type                                                     | Required | Default        | Description                                                              |
| ----------- | -------------------------------------------------------- | -------- | -------------- | ------------------------------------------------------------------------ |
| `items`     | `(string \| { text, level?, id?, revision? })[]` (min 1) | **yes**  | —              | `level` is 0–8; `id` bookmarks the item (see below)                      |
| `reference` | `string`                                                 | no       | auto-generated | Numbering configuration ID (share it to continue numbering across lists) |
| `levels`    | `Level[]` (1–9 items)                                    | no       | —              | Per-level configuration (see below)                                      |
| `format`    | LevelFormat \| `'numbered'` \| `'none'`                  | no       | bullets        | Shorthand for the level-0 format                                         |
| `bullet`    | `string`                                                 | no       | —              | Custom bullet character                                                  |
| `start`     | `number` (≥ 1)                                           | no       | `1`            | Level-0 starting number (applies with or without `levels`)               |
| `spacing`   | `{ before?, after?, item? }` (points)                    | no       | —              | `item` = spacing between items                                           |
| `alignment` | `'left'` \| `'center'` \| `'right'` \| `'justify'`       | no       | —              |                                                                          |
| `indent`    | `number` \| `{ left?, hanging? }`                        | no       | —              |                                                                          |
| `comment`   | `Comment`                                                | no       | —              | Review comment spanning the whole list (see [Comments](#comments))       |

**Level**

| Field       | Type                                                        | Required | Default | Description                                                                                                                                                                                                        |
| ----------- | ----------------------------------------------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `level`     | `0`–`8`                                                     | **yes**  | —       | Which nesting level this configures                                                                                                                                                                                |
| `format`    | LevelFormat                                                 | no       | —       | `decimal`, `upperRoman`, `lowerRoman`, `upperLetter`, `lowerLetter`, `bullet`, `ordinal`, `ordinalText`, `hex`, `chicago`, plus CJK/Hebrew/Arabic/Hindi/Thai formats, `none`, `numberInDash` — 60+ values in total |
| `text`      | `string`                                                    | no       | —       | Visible pattern; `%1`, `%2`, ... are the per-level counters (e.g. `"%1."`)                                                                                                                                         |
| `alignment` | `'start'` \| `'end'` \| `'left'` \| `'right'` \| `'center'` | no       | —       | Number alignment                                                                                                                                                                                                   |
| `indent`    | `{ left?, hanging? }`                                       | no       | —       | Points, converted internally (e.g. `left: 36` ≈ 0.5 in)                                                                                                                                                            |
| `start`     | `number` (≥ 1)                                              | no       | `1`     | Starting value                                                                                                                                                                                                     |
| `font`      | `{ family?, size?, color?, bold?, italic?, underline? }`    | no       | —       | Styles the marker glyph (the number or bullet) only — the list text is unaffected. `size` in points, `color` accepts a hex value or a theme colour token                                                           |

```json
{
  "name": "list",
  "props": {
    "levels": [
      {
        "level": 0,
        "format": "upperRoman",
        "text": "%1.",
        "font": { "color": "primary", "bold": true }
      },
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

**Item ids.** An item written as an object may carry an `id`, which bookmarks that item: `[jump](#id)` links to it, and `[@id]` [cross-references](#cross-references) it — rendering its counter (`3`, `c`, `iv`) for a numbered level, or its text with `[@id:none]`. Two lists sharing a `reference` share one counter, so an item in the second list numbers on from the first.

## `toc`

A native Word table of contents built from headings (and optionally custom styles). Word refreshes it as a field.

| Prop                 | Type                                    | Required | Default              | Description                                                                                                                                                                           |
| -------------------- | --------------------------------------- | -------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pageBreak`          | `boolean`                               | no       | —                    | Page break before the TOC                                                                                                                                                             |
| `depth`              | `{ from? (1–6), to? (1–6) }`            | no       | `{ from: 1, to: 3 }` | Heading levels included                                                                                                                                                               |
| `pageNumbersDepth`   | same shape                              | no       | —                    | Which levels show page numbers                                                                                                                                                        |
| `numberingStyle`     | `'numeric'` \| `'bullet'` \| `'none'`   | no       | —                    | Accepted but not applied — Word's TOC field has no numbering switch, so entries inherit numbering from the heading styles they reference; setting it logs a warning during generation |
| `title`              | `string`                                | no       | —                    | TOC heading                                                                                                                                                                           |
| `includePageNumbers` | `boolean`                               | no       | `true`               |                                                                                                                                                                                       |
| `numberSeparator`    | `boolean`                               | no       | `true`               | `true` = tab before the page number, `false` = space                                                                                                                                  |
| `scope`              | `'document'` \| `'section'` \| `'auto'` | no       | `'auto'`             | `auto` = section-scoped when inside a section, else document-wide                                                                                                                     |
| `styles`             | `{ styleId: string, level: 1–6 }[]`     | no       | —                    | Map custom theme styles into TOC levels                                                                                                                                               |

```json
{
  "name": "toc",
  "props": { "title": "Contents", "depth": { "to": 2 }, "pageBreak": true }
}
```

### Cached entries

The field is also written with its entries already filled in. Word refreshes it on open regardless, but readers that do not — headless LibreOffice, and therefore the PDF export path — would otherwise show nothing but the TOC title.

The cached entries are collected before rendering: headings inside the `depth` range, plus paragraphs whose `themeStyle` this TOC maps through `styles`, restricted to the TOC's own section when it is section-scoped. Headings in headers and footers never appear (they render as nothing there), and disabled subtrees are pruned.

Two things the cached copy deliberately does not have, and Word supplies on refresh:

- **No page numbers.** Nothing in generation paginates, so any number would be invented.
- **No entry hyperlinks.**

One divergence worth knowing: when a TOC declares `styles`, `docx` styles _every_ cached entry at a mapped level with that mapped style rather than `TOC{level}`. Word restores the `TOC{level}` styles the moment it refreshes the field.

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

| Prop            | Type                                                                                | Required | Default   | Description                                                                            |
| --------------- | ----------------------------------------------------------------------------------- | -------- | --------- | -------------------------------------------------------------------------------------- |
| `renderAs`      | `'table'` \| `'shape'`                                                              | no       | `'table'` | Rendering strategy (see below)                                                         |
| `width`         | `number` (px, ≥ 1) \| `"%"` string                                                  | no       | —         | Relative to content width                                                              |
| `height`        | `number` (px, ≥ 1) \| `"%"` string                                                  | no       | —         |                                                                                        |
| `floating`      | floating object                                                                     | no       | —         | Identical schema to [`image`](#image) — one shared floating schema for both components |
| `style.padding` | `{ top?, right?, bottom?, left? }` (≥ 0)                                            | no       | —         | Inner padding                                                                          |
| `style.border`  | per-side `{ style: 'solid'\|'dashed'\|'dotted'\|'double'\|'none', width?, color? }` | no       | —         | `color` takes `#`-prefixed hex or a theme color name                                   |
| `style.shading` | `{ fill?: color }`                                                                  | no       | —         | Background fill. `fill` takes the same color type as `style.border.*.color`            |

`style.shading.fill` and every `style.border.*.color` share one color type — `#RRGGBB` hex or a theme color name — enforced by the schema rather than at render time. Malformed values (`#F0F`, `#GGGGGG`, `rgb(240, 253, 244)`, `light green`, a digit-leading bare hex such as `0F0FDF`, the empty string) are rejected at validation. A letter-leading bare hex such as `F0FDF4` is indistinguishable from a theme color name under that pattern, so it passes validation — and resolves as hex at render, since no theme color name is six hex characters. Write `#F0FDF4` anyway; it is the only form that works whether the value starts with a digit or a letter.

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

### `renderAs`: table or shape

The default `'table'` renders the box as a borderless one-cell table. `'shape'` renders a native Word text box (a `wps:wsp` DrawingML shape) instead — the thing Word's own Insert → Text Box produces. The two trade different capabilities:

| Capability                     | `'table'` (default)                                 | `'shape'`                                                                  |
| ------------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------- |
| Height                         | Auto-fits the content                               | Fixed; `width` **and** `height` are required, content that overflows clips |
| Text wrapping                  | Table float clearances only                         | Real wrap modes (`square`, `topAndBottom`, `none`, …)                      |
| Z-order / behind text          | Not available                                       | `floating.zIndex`, `floating.behindDocument`                               |
| Borders                        | Per side, each with its own style, width and colour | One uniform `solid` outline                                                |
| Border **and** fill together   | Both                                                | Fill only — see below                                                      |
| `width` / `height` percentages | Resolved by Word, so they follow the page           | Resolved at generation time against the current content box                |
| Children                       | Anything, including nested `columns`                | Paragraph-producing components only                                        |

Two shape limits are **rejected at validation**, so a document that validates gets the shape it asked for:

- a missing `width` or `height` — a shape has no autofit, so its size cannot come from its content;
- a `dashed`, `dotted` or `double` border — a shape outline carries no dash pattern.

Both errors name the two ways out: fix the prop, or drop to `renderAs: 'table'`, which auto-fits and draws every border style.

One limit stays a **render-time fallback**, because it depends on what the children render to rather than on the props: non-paragraph content (a nested `columns`, which renders as a table) degrades to the table rendering with a warning.

Two further warnings report a downgrade inside shape mode rather than a fallback: per-side borders that disagree (the first declared side of top/left/bottom/right wins), and a percentage size being frozen.

A shape cannot carry both `style.shading.fill` and `style.border`: docx 9.7.1 writes the two fill groups in an order Word rejects, so when both are given the fill is kept, the border dropped, and a warning raised. Use one or the other, or stay on the table path.

## `highcharts`

Renders a chart through a Highcharts export server and embeds the result as an image. Requires a Node.js environment and a reachable export server (or the `services.highcharts` generation option). See [Charts](/guide/charts).

| Prop               | Type                          | Required | Default                 | Description                                                                                                                                                                                                |
| ------------------ | ----------------------------- | -------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `options`          | Highcharts config object      | **yes**  | —                       | Passed to the export server as written, except that a missing top-level `colors` is filled from the [theme palette](/guide/charts#theme-palette); `chart.width` and `chart.height` (numbers) are mandatory |
| `scale`            | `number`                      | no       | —                       | Export scale factor (higher = sharper raster)                                                                                                                                                              |
| `resources`        | `{ css?, js?, files? }`       | no       | —                       | Forwarded to the export server; enables custom `@font-face`, plugins                                                                                                                                       |
| `serverUrl`        | `string`                      | no       | `http://localhost:7801` | Export server URL override; takes precedence over the `services.highcharts` config, which in turn overrides the default `http://localhost:7801`                                                            |
| `width` / `height` | `number` (px) \| `"%"` string | no       | —                       | Rendered image size in the document                                                                                                                                                                        |

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

## `chart`

A native Word chart: a real chart part with its own embedded workbook, not a picture. Recipients can restyle it with Word's chart tools and open its numbers with **Edit Data**, and it stays crisp at any zoom. No export server and no network access — unlike [`highcharts`](#highcharts), it also works in the browser.

::: warning Requires `renderer: "office-open"`
docx.js has no chart primitive at all, so the component exists only in the `office-open` branch of the schema. Under the default renderer it is not a valid component name, and a document that uses it is refused with `unsupported_renderer_feature` rather than rendered without the figure. See [Charts](/guide/charts).
:::

| Prop                                           | Type                                                                                             | Required | Default                    | Description                                                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`                                         | `area` \| `bar` \| `bubble` \| `column` \| `doughnut` \| `line` \| `pie` \| `radar` \| `scatter` | **yes**  | —                          | Chart type                                                                                                                                              |
| `data`                                         | array of `{ name?, labels, values, sizes? }`                                                     | **yes**  | —                          | Series. `labels` and `values` are needed on **every** series, must be the same length, and every series must name the same categories in the same order |
| `title`                                        | `string`                                                                                         | no       | —                          | Chart title                                                                                                                                             |
| `showTitle`                                    | `boolean`                                                                                        | no       | `true` when `title` is set | Set `false` to keep a title in the JSON without drawing it                                                                                              |
| `showLegend`                                   | `boolean`                                                                                        | no       | —                          | Show the legend                                                                                                                                         |
| `legendPos`                                    | `b` \| `l` \| `r` \| `t` \| `tr`                                                                 | no       | `b`                        | Legend position                                                                                                                                         |
| `chartColors`                                  | `string[]`                                                                                       | no       | theme palette              | Series colors, hex or semantic theme names. Unset pulls the [theme palette](/guide/charts#theme-palette); a palette shorter than the series list wraps  |
| `catAxisTitle`                                 | `string`                                                                                         | no       | —                          | Category axis title                                                                                                                                     |
| `valAxisTitle`                                 | `string`                                                                                         | no       | —                          | Value axis title                                                                                                                                        |
| `width` / `height`                             | `number` (inches)                                                                                | no       | content width / `3`        | Placed size. Inches, not pixels — a chart is vector, so there is no intrinsic pixel size to scale from                                                  |
| `alignment`                                    | alignment                                                                                        | no       | `center`                   | Paragraph alignment                                                                                                                                     |
| `caption`                                      | `string`                                                                                         | no       | —                          | Caption paragraph after the chart; supports `**bold**` and `*italic*`                                                                                   |
| `alt`                                          | `string`                                                                                         | no       | —                          | Alternative text for accessibility                                                                                                                      |
| `spacing`, `floating`, `keepNext`, `keepLines` | as [`image`](#image)                                                                             | no       | —                          | Same flow placement vocabulary as every other figure                                                                                                    |

Slide coordinates (`x`, `y`, `w`, `h`) are **rejected**, not ignored: a Word chart flows with the document, so there is nowhere for them to mean anything.

```json
{
  "name": "chart",
  "props": {
    "type": "bar",
    "data": [
      {
        "name": "Revenue",
        "labels": ["Q1", "Q2", "Q3"],
        "values": [120, 132, 145]
      },
      { "name": "Cost", "labels": ["Q1", "Q2", "Q3"], "values": [80, 84, 91] }
    ],
    "title": "Revenue by quarter",
    "showLegend": true,
    "catAxisTitle": "Quarter",
    "valAxisTitle": "EUR (thousands)",
    "width": 6,
    "height": 3.2,
    "caption": "Revenue and cost, first three quarters.",
    "alt": "Bar chart comparing quarterly revenue and cost"
  }
}
```

## `visual`

A free-canvas graphic — absolute positioning, overlapping shapes and layered art that the document flow cannot express. There are two ways to draw one, chosen with `renderMode`.

**`raster`** (the default, and what an omitted `renderMode` means) authors the canvas as a **single PPTX slide** — text, shapes, images, tables and charts positioned in inches — rasterized to a PNG by a PPTX rendering service and placed like an [`image`](#image). This gives Word documents the full expressiveness of the slide engine; see the [PPTX component reference](/reference/pptx/components) for the element types.

**`native`** draws the same canvas as one Word **DrawingML group**: real text boxes, real shapes, real pictures, with no PPTX, no rasterization service and no PNG. Text stays searchable and every object stays editable in Word. It requires `"renderer": "office-open"` on the document, and its content model is narrower — see [Native mode](#visual-native-mode) below.

| Prop                                              | Type                                | Required | Default                          | Description                                                                                                                                        |
| ------------------------------------------------- | ----------------------------------- | -------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `renderMode`                                      | `'raster'` \| `'native'`            | no       | `'raster'`                       | `'native'` draws a Word drawing group instead of a rasterized slide, and requires `"renderer": "office-open"`                                      |
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
`flattenVisuals(doc, { rasterize, dpi?, concurrency? })` pre-renders every enabled **raster** `visual` into a plain base64 `image` node — including visuals inside section headers/footers and table cells — producing a portable `.docx.json` that renders with no services configured. Disabled visuals (`enabled: false`) are left untouched, and so are native ones: they already need no service, and flattening would trade their editable objects for pixels. See the [API reference](/reference/api).
:::

### Native mode {#visual-native-mode}

Set `"renderMode": "native"` and the document's `"renderer": "office-open"`, and the canvas becomes a `wpg:wgp` drawing group placed exactly the way a raster visual is — same `width`/`height`, `alignment`, `caption`, `alt`, `spacing`, `floating`, `keepNext` and `keepLines`.

`dpi` and `serverUrl` are **not valid** in native mode: nothing is rasterized, so a resolution or a service URL would describe work that never happens. Setting either is a validation error, as is `renderMode: "native"` under any other renderer.

**Canvas.** `{ width, height }` in inches, plus an optional `background` of a `color` and/or an `image`. A background colour becomes the bottom-most rectangle and a background image the bottom-most picture. There is no `theme`: a native visual resolves colours against the document's own docx theme, not a PPTX one.

**Elements.** Three kinds — `text`, `shape` and `image` — drawn in array order, so later elements sit above earlier ones. `table`, `chart` and `highcharts` have no native form and are rejected by name; use `renderMode: "raster"` for those. Every native props schema is strict: a property native mode cannot draw is a validation error rather than a silent no-op.

Positions and sizes are **inches**, or a percentage string resolved against the canvas on that axis (`"50%"`). Colours are `#RRGGBB`, bare `RRGGBB`, or a docx theme colour name.

| Element | Props                                                                                                                                                                                                                                                                                          |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`  | `text` or `runs` (`{ text, fontFace?, fontSize?, color?, bold?, italic?, underline?, strike?, breakLine? }`), `x`, `y`, `w`, `h`, `fontFace`, `fontSize`, `color`, `bold`, `italic`, `underline`, `strike`, `align`, `valign`, `margin`, `fill`, `rotate`                                      |
| `shape` | `type` (the same preset list as a PPTX shape), `x`, `y`, `w`, `h`, `fill` (`{ color?, transparency? }`), `line` (`{ color?, width?, dashType? }`), `text` (string or segments), `fontFace`, `fontSize`, `fontColor`, `bold`, `italic`, `align`, `valign`, `margin`, `rotate`, `flipH`, `flipV` |
| `image` | `path` / `base64` / `svg`, `x`, `y`, `w`, `h`, `sizing` (`{ type: 'contain' \| 'cover' \| 'crop', w?, h? }` — `sizing.w`/`sizing.h` state the box and outrank the element's own `w`/`h`, as they do in raster mode), `rotate`, `alt`                                                           |

An unstated `w` covers three quarters of the canvas for `text` and `shape`; an unstated `h` is derived from the font size for `text`. An `image` sizes itself instead: one unstated axis comes from the image's own proportions, and an image that states neither is drawn at its stored size (falling back to three quarters of the canvas width only when that size cannot be read). Omitting `width`/`height` on the component places the drawing at the canvas's physical size, so a 6.5 × 3 inch canvas prints 6.5 × 3. An SVG stays vector, with a raster fallback beside it for Word before 2016. An element with `enabled: false` draws nothing.

```json
{
  "name": "visual",
  "props": {
    "renderMode": "native",
    "caption": "**Figure 2.** Drawn natively — the text is still text.",
    "canvas": {
      "width": 6.5,
      "height": 3,
      "background": { "color": "#F5F7FA" }
    },
    "elements": [
      {
        "name": "shape",
        "props": {
          "type": "roundRect",
          "x": 0.25,
          "y": 0.25,
          "w": 2,
          "h": 1,
          "fill": { "color": "#0F172A" },
          "line": { "color": "#334155", "width": 1.5, "dashType": "dash" }
        }
      },
      {
        "name": "text",
        "props": {
          "text": "Editable Word content",
          "x": 2.5,
          "y": 0.4,
          "w": 3.5,
          "h": 0.5,
          "fontSize": 22,
          "bold": true
        }
      }
    ]
  }
}
```

## `text-space-after`

An **example plugin component**, not part of the standard registry: a document using it fails default validation (`unknown_component`) and the stock renderer rejects it. It ships as a reference implementation of the plugin component API (`packages/core-docx/src/plugin/example/text-space-after.component.ts`) and must be registered on a custom generator before use:

```ts
const generator = createDocumentGenerator({}).addComponent(
  textSpaceAfterComponent
);
```

Once registered, it takes `{ text: string, spaceAfter?: number }` — the text to display and the trailing space in points — and renders as a paragraph with that `spacing.after`. See the plugin API in the [API reference](/reference/api).

## Revisions (tracked changes)

`heading`, `paragraph`, individual `list` items and table cells can carry a `revision` prop describing word-level edits, rendered as native Word tracked changes (`w:ins`/`w:del`). Whole table rows can be marked inserted or deleted through `props.rows` (see [Table rows](#table-rows)). The [diff engine](/guide/writing-docx#tracked-changes-diffing-two-documents) generates all of these automatically; you can also author them by hand.

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

### Table rows

The table model is column-major (`columns[].cells[rowIndex]`), so anything belonging to a whole row lives in a row-parallel `props.rows` array, indexed the same way as `cells`:

```json
{
  "name": "table",
  "props": {
    "columns": [
      {
        "header": { "content": "Tier" },
        "cells": [{ "content": "Basic" }, { "content": "Legacy" }]
      }
    ],
    "rows": [{}, { "revision": { "type": "delete", "author": "Legal" } }]
  }
}
```

| Field         | Type                                             | Description                                                        |
| ------------- | ------------------------------------------------ | ------------------------------------------------------------------ |
| `revision`    | `{ type: 'insert' \| 'delete', author?, date? }` | The row itself was inserted or deleted (`w:trPr/w:ins` \| `w:del`) |
| `cantSplit`   | `boolean`                                        | Keep this row on one page                                          |
| `tableHeader` | `boolean`                                        | Repeat this row as a header on each page                           |

A row revision is structural, so it uses a different shape from the text `Revision` above — there is no text to segment. Marking a row deleted also renders its cell text as deleted runs and marks each cell's closing paragraph mark: without that second half, accepting the change in Word would leave an empty row behind instead of removing it.

Not supported, and reported as untracked by the differ: column insert/delete, cell merging, and the `*PrChange` family (formatting-only tracked changes).

`rows` is excluded from `componentDefaults.table`: it is optional on a table, so a theme's `rows` would otherwise reach every table that does not declare its own and mark the same row inserted or deleted. `columns` stays allowed but has no effect — theme defaults replace arrays wholesale rather than merging them, and `columns` is required on every table, so an instance always supplies its own.

Set `trackRevisions: true` on the [`docx` root](/reference/docx/document#docx-root) to open the document with track-changes mode active (redlines produced by `diffDocuments` do this automatically). `revision` is deliberately excluded from `componentDefaults` — revisions describe specific edits and cannot be defaulted.

## Footnotes and endnotes

A note is authored in two halves: an inline `[^id]` marker in a `paragraph`'s text, and the body declared on that same paragraph. Footnotes and endnotes share the marker syntax and differ only in where Word puts the body — the foot of the page, or the end of the document.

```json
{
  "name": "paragraph",
  "props": {
    "text": "Revenue grew 12%[^rev] year over year.",
    "footnotes": [
      { "id": "rev", "text": "Source: FY26 audited accounts, page 14." }
    ]
  }
}
```

The marker renders as a superscript reference; Word numbers the notes and places them at the foot of the page. Declare the body under `endnotes` instead to collect it at the end of the document:

```json
{
  "name": "paragraph",
  "props": {
    "text": "Sampling followed the standard protocol[^proto].",
    "endnotes": [
      { "id": "proto", "text": "See Annex B for the full protocol." }
    ]
  }
}
```

**Note**

| Field  | Type             | Required | Description                                               |
| ------ | ---------------- | -------- | --------------------------------------------------------- |
| `id`   | `string` (min 1) | **yes**  | Referenced from the text as `[^id]`; no whitespace or `]` |
| `text` | `string` (min 1) | **yes**  | Body; newlines split it into separate paragraphs          |

Rules worth knowing:

- **`[^id]` is only syntax where notes are declared.** A paragraph with neither `footnotes` nor `endnotes` renders `[^a-z]+` exactly as written, so regexes and character classes in prose are safe.
- **An id is resolved against `footnotes` first, then `endnotes`.** Declaring the same id twice — in one array or across both — logs a warning and uses the first declaration, so the outcome does not depend on authoring order.
- **Notes and `revision` do not combine, and the pair is rejected at validation.** Tracked-change text renders literally, so a marker inside it cannot resolve — and `docx` offers no way to place a footnote reference inside `w:ins`/`w:del` at all. Put the notes on a paragraph without a revision. (Callers that disable validation get a warning naming the notes that will be dropped.)
- **Numbering follows reference order, not declaration order**, and footnotes and endnotes number independently — they are separate parts. A body that no marker resolves to is not emitted, and a warning names it.
- **Repeating a marker reuses the same note** rather than duplicating the body.
- Markers resolve inside decorated text and around links (`**bold[^n]**`, `[a link](https://example.com)[^m]`), but **not** in text that also contains `{PLACEHOLDER}` substitutions — there the marker stays literal and a warning says so.
- Notes are a `paragraph` prop only — including a paragraph whose text is markdown list syntax. Like `revision` and `comment`, they are excluded from `componentDefaults`.

Note text is styled from the theme's `normal` style, two points smaller, through Word's built-in `FootnoteText`/`FootnoteReference` and `EndnoteText`/`EndnoteReference` styles.

## Comments

`heading`, `paragraph`, `list` and table cells (header and body alike) can carry a `comment` prop: a Word review comment anchored to that component's text. The text itself is unchanged — the runs are wrapped in a comment range and the body goes to `word/comments.xml`, so a reader that ignores comments sees exactly the same document.

**Comment**

| Field      | Type                | Required | Default                               | Description                                       |
| ---------- | ------------------- | -------- | ------------------------------------- | ------------------------------------------------- |
| `text`     | `string` (min 1)    | **yes**  | —                                     | Comment body; newlines become separate paragraphs |
| `author`   | `string`            | no       | `"json-to-office"`                    | Shown in Word's review pane                       |
| `initials` | `string`            | no       | derived from `author`                 | Shown on the comment bubble                       |
| `date`     | `string` (ISO 8601) | no       | Unix epoch (for deterministic output) | Comment timestamp                                 |
| `replies`  | `Reply[]` (min 1)   | no       | —                                     | Replies, in order — Word shows them as one thread |
| `resolved` | `boolean`           | no       | —                                     | Marks the whole thread resolved (`w15:done`)      |

**Reply**: `{ text, author?, initials?, date? }` — the same fields as a comment, minus threading. Word threads are one level deep, so a reply cannot itself carry replies.

```json
{
  "name": "paragraph",
  "props": {
    "text": "Revenue grew 12% year over year.",
    "comment": {
      "text": "Confirm this figure with finance before circulating.",
      "author": "Reviewer One",
      "date": "2026-06-09T10:00:00Z",
      "replies": [
        {
          "text": "Confirmed against the audited accounts.",
          "author": "Reviewer Two"
        }
      ],
      "resolved": true
    }
  }
}
```

On a `list` — or a `paragraph` whose text is markdown list syntax — the comment anchors to the list as a whole: the range opens on the first rendered item and closes on the last. On a table cell it wraps whatever the cell renders, string or component; a cell with no content still gets a zero-length anchor, so the comment survives.

Every comment in a thread anchors over the same range, which is how Word groups them. Thread parentage is derived, never authored: the renderer writes `word/commentsExtended.xml` with each reply pointing at its root.

One limitation worth knowing: Word stores the resolved flag in that same part, and `docx` writes the part only when the document contains at least one reply. Setting `resolved` on a comment with no replies anywhere in the document logs a warning and the flag does not survive.

Comment ids live in their own OOXML namespace, separate from the `w:ins`/`w:del` ids used by revisions, and are allocated per render. Like `revision`, `comment` is deliberately excluded from `componentDefaults` — a shared default would attach the same comment to every component.
