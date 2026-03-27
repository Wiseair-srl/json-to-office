# @json-to-office/json-to-pptx

**Presentations as data, not code.** Generate professional `.pptx` files from JSON definitions — serializable, schema-validated, LLM-friendly.

[![npm](https://img.shields.io/npm/v/@json-to-office/json-to-pptx.svg)](https://www.npmjs.com/package/@json-to-office/json-to-pptx)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/Wiseair-srl/json-to-office/blob/main/LICENSE)

Part of the [json-to-office](https://github.com/Wiseair-srl/json-to-office) monorepo.

## Install

```bash
npm install @json-to-office/json-to-pptx pptxgenjs
```

## Usage

```ts
import { generateBufferFromJson } from '@json-to-office/json-to-pptx';
import { writeFileSync } from 'fs';

const buffer = await generateBufferFromJson({
  name: 'pptx',
  props: {
    title: 'Q1 Review',
    theme: 'corporate',
    grid: { columns: 12, rows: 6 },
  },
  children: [
    {
      name: 'slide',
      props: { background: { color: 'background' } },
      children: [
        {
          name: 'text',
          props: {
            text: 'Q1 Results',
            style: 'title',
            grid: { column: 0, row: 0, columnSpan: 12 },
          },
        },
        {
          name: 'chart',
          props: {
            chartType: 'bar',
            data: [{ name: 'Revenue ($M)', values: [1.2, 2.4, 3.1, 4.2] }],
            grid: { column: 0, row: 1, columnSpan: 8, rowSpan: 5 },
          },
        },
        {
          name: 'shape',
          props: {
            type: 'roundRect',
            fill: { color: 'accent' },
            text: 'Revenue\n$4.2M',
            bold: true,
            fontColor: 'FFFFFF',
            grid: { column: 8, row: 1, columnSpan: 4, rowSpan: 2 },
          },
        },
      ],
    },
  ],
});

writeFileSync('deck.pptx', buffer);
```

## Components

7 component types: **text** (bullets, hyperlinks, style presets), **image** (URL/file/base64, rotation, rounded corners, shadows), **shape** (15 types: rect, ellipse, arrow, star, cloud, etc.), **table** (auto-pagination with header repeat, colspan/rowspan), **chart** (8 native PowerPoint types: bar, line, pie, area, doughnut, radar, bubble, scatter), **highcharts**, and **slides** with grid-based positioning.

## Highlights

- **Grid layout** — 12-column responsive grid with configurable margins and gutters. Position elements by grid coordinates or absolute inches/percentages.
- **Theme system** — 10-slot semantic color scheme, text style presets, 3 built-in themes (minimal, corporate, vibrant) or define your own.
- **Template/placeholder system** — Define reusable slide templates with named placeholder regions, static elements, and style inheritance.
- **Schema validation** — TypeBox schemas as both TypeScript types and runtime validators.
- **Native charts** — 8 PowerPoint chart types rendered natively (no image export needed).
- **Peer dependency** — Uses [pptxgenjs](https://github.com/gitbrent/PptxGenJS) as the rendering backend. You control the version.

## License

[MIT](https://github.com/Wiseair-srl/json-to-office/blob/main/LICENSE) — Wiseair srl
