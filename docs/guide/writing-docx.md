# Writing DOCX documents

A Word document in json-to-office is a single JSON tree: a `docx` root, one or more `section` containers, and content components inside them. This page walks through authoring that tree by hand — from a bare skeleton to headers, tables, images, multi-column layouts, and tracked changes.

If you have not rendered anything yet, start with [Getting started](/guide/getting-started). For exhaustive props tables, see the [document reference](/reference/docx/document) and the [component reference](/reference/docx/components).

## The document skeleton

Every node in the tree has the same shape: `{ "name", "props", "children" }`, plus optional `id` and `enabled` fields (`enabled: false` removes a node from the render without deleting it from your JSON). The root must be a `docx` component, and its children must be `section` components — sections are the only thing that can sit directly under the root.

```json
{
  "name": "docx",
  "props": {
    "theme": "minimal",
    "metadata": { "title": "Q3 Report", "author": "Ada Lovelace" }
  },
  "children": [
    {
      "name": "section",
      "children": [
        {
          "name": "heading",
          "props": { "text": "Quarterly Report", "level": 1 }
        },
        {
          "name": "paragraph",
          "props": { "text": "Everything in this document is plain JSON." }
        }
      ]
    }
  ]
}
```

Sections map to Word sections: each one can carry its own header, footer, page size, and margins. A section flows continuously unless you set `pageBreak: true` — the schema defaults it to `true`, but every built-in theme overrides it to `false` via `componentDefaults`. That default applies whether or not the node declares `props`: a section with no `props` key behaves exactly like one with `"props": {}`. (This changed — propless nodes used to skip the cascade and break to a new page; set `"pageBreak": true` explicitly if you were relying on that.) The `theme` prop picks one of the built-in themes (`minimal`, `devportal`, `vermilion`, `consulting`) or a custom one; see [Themes & styling](/guide/themes).

`metadata` on the root is not decoration: it lands in Word's document properties — `title`, `author`, `description`, `tags` and `subtitle` in File → Info → Properties, and `company` and `version` as custom properties. There are no `created`/`modified` fields: package timestamps come from the `generatedAt` generation option instead. The full mapping is in the [document reference](/reference/docx/document#metadata-fields).

Render it with the library:

```ts
import { generateAndSaveFromJson } from '@json-to-office/json-to-docx';
import { readFileSync } from 'node:fs';

await generateAndSaveFromJson(
  readFileSync('report.docx.json', 'utf-8'),
  'report.docx'
);
```

Or with the CLI (see [the CLI guide](/guide/cli)):

```bash
jto docx generate report.docx.json -o report.docx
```

## Headings, paragraphs, and inline formatting

`heading` and `paragraph` both take a required `text` prop, and the text supports a small inline markdown dialect:

- `**bold**` or `__bold__`, `*italic*` or `_italic_`, `***bold italic***`
- `\n` for line breaks within one paragraph
- `[link text](https://example.com)` for hyperlinks
- `[@id]` for a cross-reference to a numbered heading or list item
- `{PLACEHOLDER}` for dynamic content

The built-in placeholders are `{PAGE}` (current page number), `{TOTAL_PAGES}`, `{DATE}`, `{DATETIME}`, and `{YEAR}`. Unknown placeholders are left in the text as-is, so stray braces will not break a render.

```json
{
  "name": "paragraph",
  "props": {
    "text": "Generated on {DATE}. See the **methodology** in [Appendix A](#appendix-a), or the *raw data* [online](https://example.com/data).",
    "alignment": "justify"
  }
}
```

### Internal links and bookmarks

A hyperlink whose URL starts with `#` becomes an internal bookmark link. The target is a paragraph carrying a matching `id` prop:

```json
[
  {
    "name": "paragraph",
    "props": { "text": "Jump to the [conclusions](#conclusions)." }
  },
  {
    "name": "paragraph",
    "props": {
      "id": "conclusions",
      "text": "**Conclusions.** Revenue grew 14% year over year."
    }
  }
]
```

### Numbered headings and cross-references

`"numbering": true` on a heading puts it in the document's `1.` / `1.1.` / `1.1.1.` sequence — Word renders the number, so it stays right when sections move. Turn it on for every heading through the theme's `componentDefaults.heading.numbering`, and set `"numbering": false` on the odd heading that should stay unnumbered.

Once a heading is numbered, `[@id]` in any text references it: the number is written as a hyperlinked Word `REF` field. Headings take the `id` from their node `id`, or from a slug of their text; list items take one written on the item. `[@id:none]` references the target's text instead of its number.

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

"Field study" numbers `1.` and "Methods" numbers `1.1.`, so the paragraph reads "Sampling is described in 1.1 (Methods)." A heading numbered before any heading of the level above it fills the missing places with zeros — `0.1` — exactly as Word does.

See [cross-references](/reference/docx/components#cross-references) for the other switches and the caveats about cached values.

Paragraphs also accept `font` (a partial font override: family, size, color, bold, `fontWeight`, italic, underline, ...), `themeStyle` (a named style from the theme's `styles` map), `boldColor` (a color applied only to `**bold**` segments), `spacing`, `keepNext`/`keepLines`, and page/column breaks. Headings take `level` 1–6 (default 1) and feed the table of contents automatically.

::: tip Proofing control
Set `language` on the root `docx` (e.g. `"en-US"`) to define Word's proofing language, and use `noProofWords` — at document or component level — to exempt product names and jargon from spell-check squiggles. Individual components can also set `noProof: true` to disable proofing entirely.
:::

## Headers and footers

Headers and footers live on sections, as arrays of ordinary components. Placeholders are what make them useful — `{PAGE}` and `{TOTAL_PAGES}` render as live Word fields:

```json
{
  "name": "section",
  "props": {
    "header": [
      {
        "name": "paragraph",
        "props": { "text": "**Acme Corp** — Q3 Report", "alignment": "right" }
      }
    ],
    "footer": [
      {
        "name": "paragraph",
        "props": {
          "text": "Page {PAGE} of {TOTAL_PAGES}",
          "alignment": "center"
        }
      }
    ]
  },
  "children": [
    { "name": "heading", "props": { "text": "Introduction", "level": 1 } }
  ]
}
```

A later section can reuse the previous section's header or footer by passing the string `"linkToPrevious"` instead of an array:

```json
{
  "name": "section",
  "props": { "header": "linkToPrevious", "footer": "linkToPrevious" },
  "children": [
    { "name": "heading", "props": { "text": "Chapter 2", "level": 1 } }
  ]
}
```

### Report chrome from a block

For a report, do not hand-build the header and footer. A `running-head` block, declared once as a child of the first section after the cover, writes a themed header (document title left, section tracker right, hairline beneath) and footer (confidentiality, page `n / N`, date) into that section and every later one, and each section's `section-opener` changes the tracker. A section that authors its own `header` or `footer` keeps it.

```json
{
  "name": "section",
  "children": [
    {
      "name": "running-head",
      "props": { "confidentiality": "Confidential", "date": "September 2026" }
    },
    {
      "name": "section-opener",
      "props": { "number": "01", "title": "Summary" }
    },
    { "name": "paragraph", "props": { "text": "The year in one page." } }
  ]
}
```

The `cover` block goes in a section of its own before it, so the cover page carries no running head. See the [block reference](/reference/docx/components#cover) for every slot.

## Tables

Tables are **column-based**, not row-based: you describe each column once — its header, width, and per-column cell defaults — and list its cells top to bottom. This keeps column styling in one place instead of repeating it on every row.

```json
{
  "name": "table",
  "props": {
    "width": 100,
    "repeatHeaderOnPageBreak": true,
    "headerCellDefaults": {
      "backgroundColor": "#1F2937",
      "color": "#FFFFFF",
      "font": { "bold": true }
    },
    "cellDefaults": { "padding": 4 },
    "columns": [
      {
        "width": "50%",
        "header": { "content": "Item" },
        "cells": [
          { "content": "Design retainer" },
          { "content": "Implementation" }
        ]
      },
      {
        "header": { "content": "Qty", "horizontalAlignment": "center" },
        "cellDefaults": { "horizontalAlignment": "center" },
        "cells": [{ "content": "1" }, { "content": "3" }]
      },
      {
        "header": { "content": "Amount", "horizontalAlignment": "right" },
        "cellDefaults": { "horizontalAlignment": "right" },
        "cells": [{ "content": "€4,800" }, { "content": "€9,600" }]
      }
    ]
  }
}
```

Column widths are points, or `"%"` strings relative to the table width; columns without a width share the leftover space. A cell's `content` can be a plain string — or a full nested component (an `image`, a `list`, even a `columns` block), which is how you build composite layouts inside cells. Border color/size, `hideBorders` (globally or per side, including `insideHorizontal`/`insideVertical`), cell padding, and background colors are all available; see the [table reference](/reference/docx/components#table).

## Lists

The `items` array accepts plain strings or objects with a `level` (0–8) for nesting and an optional `id` that bookmarks the item, so `[jump](#id)` links to it and `[@id]` [cross-references](/reference/docx/components#cross-references) its number. By default you get bullets; `format` switches level 0 to numbering, and `levels` gives full per-level control:

```json
{
  "name": "list",
  "props": {
    "format": "decimal",
    "items": [
      "Kickoff and scoping",
      { "text": "Stakeholder interviews", "level": 1 },
      { "text": "Technical audit", "level": 1 },
      "Implementation",
      "Handover"
    ]
  }
}
```

For mixed numbering schemes, define each level explicitly — `format` names a numbering style (`decimal`, `lowerLetter`, `upperRoman`, `bullet`, and 60+ more), `text` is the visible pattern where `%1` is the first level's (level 0) counter, and `indent` is in points:

```json
{
  "name": "list",
  "props": {
    "levels": [
      { "level": 0, "format": "decimal", "text": "%1." },
      { "level": 1, "format": "lowerLetter", "text": "%2)" }
    ],
    "items": [
      "Terms",
      { "text": "Payment schedule", "level": 1 },
      { "text": "Late fees", "level": 1 }
    ]
  }
}
```

`spacing` on lists takes an extra `item` field — the space between consecutive items — alongside the usual `before`/`after`.

## Images

An image needs exactly one source — `path` (file path or URL), `base64` (data URI), or `svg` (raw inline SVG markup, kept as a vector in Word 2016+). Providing two sources is a validation error.

```json
{
  "name": "image",
  "props": {
    "path": "./assets/chart.png",
    "width": "70%",
    "alignment": "center",
    "alt": "Monthly revenue chart",
    "caption": "**Figure 2.** Revenue by month, *FY2026*."
  }
}
```

Sizing: `width` and `height` are pixels or `"%"` strings, and percentages are relative to `widthRelativeTo`/`heightRelativeTo` — `"content"` (the page minus margins, the default) or `"page"`. `width` defaults to `"100%"`. Captions support `**bold**`, `*italic*`, and `***both***`.

For images that text should flow around, use `floating` — anchored positioning with full control over horizontal/vertical position (relative to margin, page, column, paragraph, ...), wrap mode (`square`, `tight`, `topAndBottom`, `none`, ...), `behindDocument`, `zIndex`, and `rotation`:

```json
{
  "name": "image",
  "props": {
    "path": "./assets/portrait.jpg",
    "width": 180,
    "floating": {
      "horizontalPosition": { "relative": "margin", "align": "right" },
      "verticalPosition": { "relative": "paragraph", "offset": 0 },
      "wrap": { "type": "square", "side": "left" }
    }
  }
}
```

::: warning Units differ by context
Image `width`/`height` are **pixels**; floating offsets are **twips** (1/20 pt) or `"%"` strings; column widths and table paddings are **points**. The [component reference](/reference/docx/components) states the unit for every prop.
:::

## Columns and text boxes

Two layout containers exist below the section level. `columns` splits content into side-by-side columns — pass a number for equal widths, or descriptors for precise control (widths and gaps in points, `"%"` strings, or `"auto"` for remaining space; the default gap is 0.5 inch):

```json
{
  "name": "columns",
  "props": { "columns": [{ "width": "60%" }, { "width": "auto" }], "gap": 24 },
  "children": [
    { "name": "heading", "props": { "text": "INVOICE", "level": 1 } },
    {
      "name": "paragraph",
      "props": {
        "text": "**#INV-2026-0387**\nDate: April 1, 2026",
        "alignment": "right"
      }
    }
  ]
}
```

Each child fills the next column. Columns accept nearly everything a section does (headings, paragraphs, images, tables, lists, charts, text boxes) — but not another `columns`.

`text-box` draws a bordered, padded, optionally floating box containing headings, paragraphs, and images — the classic callout or sidebar:

```json
{
  "name": "text-box",
  "props": {
    "width": "40%",
    "style": {
      "padding": { "top": 8, "right": 10, "bottom": 8, "left": 10 },
      "border": {
        "left": { "style": "solid", "width": 3, "color": "#2563EB" }
      },
      "shading": { "fill": "#EFF6FF" }
    }
  },
  "children": [
    { "name": "heading", "props": { "text": "Key takeaway", "level": 3 } },
    {
      "name": "paragraph",
      "props": { "text": "Churn dropped below 2% for the first time." }
    }
  ]
}
```

By default the box is a borderless one-cell table, which auto-fits its height and lets Word resolve percentage widths. Set `"renderAs": "shape"` to emit a native Word text box instead, when you need real text wrapping or z-order; it needs an explicit `width` and `height`, and takes a single uniform border. See [renderAs](/reference/docx/components#renderas-table-or-shape) for the full trade.

Both colors in that `style` block — `border.<side>.color` and `shading.fill` — take a `#`-prefixed hex or a theme color name (`"primary"`, `"accent"`, ...), and both are checked against that pattern at validation. A digit-leading bare hex such as `"0F0FDF"` fails validation outright. A letter-leading one such as `"F0FDF4"` is indistinguishable from a theme color name under that pattern, so it passes validation — and resolves as hex at render, since no theme color name is six hex characters. Write `"#F0FDF4"` anyway: it is the form the schema is built around, and the only one that works for both leading digits and letters.

## Table of contents

The `toc` component builds a native Word TOC from your headings. It updates like any Word TOC (Word prompts to refresh fields on open, or press F9).

The field ships with its entries already written in, so a reader that never refreshes fields — headless LibreOffice, and therefore PDF export — shows the real contents rather than just the title. Page numbers are the one thing the cached copy omits: nothing in generation paginates, so Word fills those in on the first refresh. See [cached entries](/reference/docx/components#cached-entries).

```json
{
  "name": "toc",
  "props": {
    "title": "Contents",
    "depth": { "from": 1, "to": 3 },
    "includePageNumbers": true,
    "pageBreak": true
  }
}
```

`scope` controls what it covers: `"document"`, `"section"`, or `"auto"` (the default — section-scoped when the TOC sits inside a section, document-wide otherwise). Custom theme styles can be mapped into the TOC via `styles: [{ "styleId": "...", "level": 2 }]`.

## Statistic KPI cards

`statistic` renders a big-number KPI block — number, unit, description, and an optional trend indicator:

```json
{
  "name": "columns",
  "props": { "columns": 3 },
  "children": [
    {
      "name": "statistic",
      "props": {
        "number": "14",
        "unit": "%",
        "description": "YoY revenue growth",
        "trend": "up",
        "trendValue": "+2.3"
      }
    },
    {
      "name": "statistic",
      "props": {
        "number": "1.9",
        "unit": "%",
        "description": "Monthly churn",
        "trend": "down",
        "trendValue": "-0.4"
      }
    },
    {
      "name": "statistic",
      "props": {
        "number": "312",
        "description": "Enterprise seats",
        "trend": "neutral"
      }
    }
  ]
}
```

Wrapping statistics in a `columns` block, as above, is the usual way to get a KPI row.

## Page setup per section

Each section can override the theme's page geometry — size (`A4`, `A3`, `LETTER`, `LEGAL`, or explicit `{width, height}`) and margins (in twips; 1440 twips = 1 inch):

```json
{
  "name": "section",
  "props": {
    "page": {
      "size": "A3",
      "margins": {
        "top": 720,
        "bottom": 720,
        "left": 1080,
        "right": 1080,
        "header": 480,
        "footer": 480
      }
    }
  },
  "children": [
    {
      "name": "heading",
      "props": { "text": "Appendix: Full data tables", "level": 1 }
    }
  ]
}
```

This is how a landscape-style data appendix or a tight-margin cover section coexists with normal pages in the same document. Document-wide defaults come from the theme's `page` block — see [the theme schema](/reference/theme-schema).

## Charts and visuals

Two components embed rendered graphics. `highcharts` sends a full Highcharts config to an export server and embeds the resulting image — see [Charts](/guide/charts). `visual` is more general: you author a free-canvas graphic as a **single PPTX slide** (text, shapes, images, tables, charts positioned in inches on a canvas), and json-to-office rasterizes it to a PNG through the PPTX engine and places it like an image:

```json
{
  "name": "visual",
  "props": {
    "canvas": {
      "width": 7.2,
      "height": 2.6,
      "background": { "color": "F4F8FF" }
    },
    "caption": "**Figure 1.** Authored as a pptx slide, embedded as an image.",
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

Rendering a `visual` this way requires a PPTX rasterization service (an HTTP endpoint or an in-process callback via `services.pptx`). The `flattenVisuals` helper can pre-render every visual into a plain base64 `image`, producing a portable `.docx.json` that needs no services at all.

Or skip the rasterizer entirely. With `"renderer": "office-open"` on the document and `"renderMode": "native"` on the visual, the same canvas is drawn as a Word **drawing group** — real text boxes, real shapes, real pictures. No PPTX, no service, no PNG: the text stays searchable and every object stays editable in Word, and the file is usually smaller and quicker to produce. The trade is a narrower content model — `text`, `shape` and `image` only, with strictly validated props — so tables and charts still need the raster path.

Full details — canvas props, DPI, service wiring, element types, and the native element model — are in the [visual reference](/reference/docx/components#visual) and the [PPTX component reference](/reference/pptx/components).

## Tracked changes: diffing two documents

Because documents are data, two versions of a document can be **diffed into a redline** — a `.docx` that opens in Word with native tracked changes (insertions, deletions, modifications), ready for Review → Accept/Reject.

From the CLI:

```bash
jto docx diff contract-v1.docx.json contract-v2.docx.json -o redline.docx --author "Legal team"
```

Useful flags: `--date <iso>` pins the revision timestamp, `--json-out <path>` also writes the redline JSON definition, `--format json` emits a machine-readable summary, and `--dry-run` computes the summary without writing files.

Programmatically:

```ts
import { diffDocuments, type JsonNode } from '@json-to-office/json-to-docx';

const { document, summary } = diffDocuments(
  oldDoc as JsonNode,
  newDoc as JsonNode,
  {
    author: 'Legal team',
    date: new Date().toISOString(),
  }
);

console.log(summary.tracked); // { modified, inserted, deleted }
console.log(summary.untracked); // structural changes Word can't express as tracked changes
```

`diffDocuments` returns a new document with `trackRevisions` enabled and per-component `revision` props describing the word-level edits; render it like any other document. Tables are diffed row by row: an added or removed row becomes a row-level tracked change, and a rewritten row becomes cell-level word changes. Changes that Word cannot express as tracked changes (for example an image swap, or a changed column count) are reported in `summary.untracked` instead of being silently dropped. You can also author `revision` segments by hand on headings, paragraphs, list items and table cells, and mark whole table rows inserted or deleted — see [Revisions](/reference/docx/components#revisions-tracked-changes).

## Where to go next

- [Document & section reference](/reference/docx/document) — every root and section prop
- [Component reference](/reference/docx/components) — the full catalog with all props and units
- [Themes & styling](/guide/themes) and [Fonts](/guide/fonts)
- [Validation](/guide/validation) — catching mistakes before render
- [Examples](/examples/) — complete documents to copy from
