# @json-to-office/json-to-docx

**Documents as data, not code.** Generate professional `.docx` files from JSON definitions — serializable, schema-validated, LLM-friendly.

[![npm](https://img.shields.io/npm/v/@json-to-office/json-to-docx.svg)](https://www.npmjs.com/package/@json-to-office/json-to-docx)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/Wiseair-srl/json-to-office/blob/main/LICENSE)

Part of the [json-to-office](https://github.com/Wiseair-srl/json-to-office) monorepo.

## Install

```bash
npm install @json-to-office/json-to-docx docx
```

## Usage

```ts
import { generateDocument } from '@json-to-office/json-to-docx';
import { Packer } from 'docx';
import { writeFileSync } from 'fs';

const doc = await generateDocument({
  name: 'docx',
  props: { theme: 'minimal' },
  children: [
    { name: 'heading', props: { text: 'Q1 Report', level: 1 } },
    {
      name: 'paragraph',
      props: { text: 'Revenue grew **32%** quarter-over-quarter.' },
    },
    {
      name: 'table',
      props: {
        columns: [
          {
            header: { content: 'Region' },
            cells: [
              { content: 'North America' },
              { content: 'Europe' },
              { content: 'APAC' },
            ],
          },
          {
            header: { content: 'Revenue' },
            cells: [
              { content: '$4.2M' },
              { content: '$2.8M' },
              { content: '$1.6M' },
            ],
          },
        ],
      },
    },
    {
      name: 'image',
      props: { path: 'https://example.com/chart.png', width: '80%' },
    },
  ],
});

const buffer = await Packer.toBuffer(doc);
writeFileSync('report.docx', buffer);
```

## Components

13 component types: **paragraph**, **heading** (h1-h6), **table** (column-based, borders, nested content, repeat header on page break), **image** (URL/file/base64, contain/cover/crop, captions, floating), **list** (57 numbering formats, 9 nesting levels), **columns**, **text-box**, **statistic** (number display with trend indicators), **highcharts**, **header/footer**, **table of contents**, and **sections** with independent page config.

## Highlights

- **Theme system** — Colors, fonts, spacing, component defaults. 3 built-in themes (minimal, modern, corporate) or define your own.
- **Schema validation** — TypeBox schemas as both TypeScript types and runtime validators.
- **Plugin architecture** — Create versioned custom components with `createComponent()`, chainable API, schema generation.
- **Rich text** — Markdown formatting (**bold**, _italic_) in paragraphs, headings, and captions.
- **Peer dependency** — Uses [docx](https://github.com/dolanmedia/docx) as the rendering backend. You control the version.

## License

[MIT](https://github.com/Wiseair-srl/json-to-office/blob/main/LICENSE) — Wiseair srl
