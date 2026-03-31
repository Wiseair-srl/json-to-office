# json-to-office

**Documents as data, not code.** Describe `.docx` and `.pptx` files as plain JSON (serializable, portable, language-agnostic) and render them into real Office documents.

[CI](https://github.com/Wiseair-srl/json-to-office/actions/workflows/ci.yml)
[npm](https://www.npmjs.com/package/@json-to-office/json-to-docx)
[License: MIT](LICENSE)

## Quick start

```bash
npm install @json-to-office/json-to-docx @json-to-office/json-to-pptx
```

```ts
import { generateAndSaveFromJson as docx } from '@json-to-office/json-to-docx';
import { generateAndSaveFromJson as pptx } from '@json-to-office/json-to-pptx';

// DOCX
await docx(
  {
    name: 'docx',
    children: [
      { name: 'heading', props: { text: 'Q1 Report', level: 1 } },
      {
        name: 'paragraph',
        props: { text: 'Revenue grew **32%** quarter-over-quarter.' },
      },
    ],
  },
  'report.docx'
);

// PPTX
await pptx(
  {
    name: 'pptx',
    props: { theme: 'corporate', grid: { columns: 12, rows: 6 } },
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
              data: [{ name: 'Revenue', values: [1.2, 2.4, 3.1, 4.2] }],
              grid: { column: 0, row: 1, columnSpan: 8, rowSpan: 5 },
            },
          },
        ],
      },
    ],
  },
  'deck.pptx'
);
```

Or explore interactively with the visual playground (Monaco editor, live preview, AI assistant):

```bash
npm install -g @json-to-office/jto
jto docx dev
jto pptx dev
```

Visual Playground

## The problem

Libraries like [docx](https://github.com/dolanmiu/docx) and [pptxgenjs](https://github.com/gitbrent/PptxGenJS) are imperative, code-first APIs. You build documents by constructing class instances and chaining methods. Powerful, but the document definition _is_ the program. You can't store it in a database, send it over an API, generate it from an LLM, or hand it to a non-developer.

## The solution

json-to-office makes the document definition **data**. You describe a `.docx` or `.pptx` as a JSON tree, and the library renders it into a real Office file. The JSON can live in a DB row, travel over HTTP, come out of GPT-4, or be edited in a visual playground with autocomplete and validation. Definition and rendering are fully decoupled.

```jsonc
// This is a complete document definition. Store it, send it, generate it.
{
  "name": "docx",
  "props": { "theme": "minimal" },
  "children": [
    { "name": "heading", "props": { "text": "Q1 Report", "level": 1 } },
    {
      "name": "paragraph",
      "props": { "text": "Revenue grew **32%** quarter-over-quarter." },
    },
    {
      "name": "table",
      "props": {
        "columns": [
          {
            "header": { "content": "Region" },
            "cells": [
              { "content": "North America" },
              { "content": "Europe" },
              { "content": "APAC" },
            ],
          },
          {
            "header": { "content": "Revenue" },
            "cells": [
              { "content": "$4.2M" },
              { "content": "$2.8M" },
              { "content": "$1.6M" },
            ],
          },
        ],
      },
    },
    {
      "name": "image",
      "props": { "path": "https://example.com/chart.png", "width": "80%" },
    },
  ],
}
```

Your document is just JSON now. Generate it, store it, validate it, version it, and render it anywhere, without touching TypeScript or Office internals.

## Why not X?

|                   | json-to-office                               | docx / pptxgenjs                       | Carbone                                  | Gamma                  | officegen       |
| ----------------- | -------------------------------------------- | -------------------------------------- | ---------------------------------------- | ---------------------- | --------------- |
| **Format**        | Declarative JSON                             | Imperative code                        | Template `.docx` + data                  | SaaS GUI               | Imperative code |
| **Serializable**  | Yes: store, send, generate from any language | No: trapped in code                    | Partially: data is JSON, structure isn't | No: locked in platform | No              |
| **LLM-friendly**  | Yes: LLMs emit JSON reliably                 | Fragile: no schema to constrain output | No: requires a pre-made template         | N/A                    | No              |
| **Validation**    | Full schema validation (TypeBox)             | None                                   | None                                     | N/A                    | None            |
| **Themes**        | Built-in theme system                        | Manual styling                         | Template-based                           | Built-in               | Manual styling  |
| **Extensibility** | Plugin architecture with semver              | N/A                                    | N/A                                      | N/A                    | N/A             |
| **Self-hosted**   | Yes                                          | Yes                                    | Yes                                      | No: SaaS only          | Yes             |
| **Dependencies**  | Node.js only                                 | Node.js only                           | Node.js + LibreOffice                    | None (hosted)          | Node.js only    |

**vs. docx / pptxgenjs**: These are json-to-office's own rendering backends. json-to-office is the declarative layer on top: a schema-validated JSON contract that compiles down to those libraries. It also adds abstractions they don't have: themes, a layout pipeline, a plugin architecture, a template/placeholder system (PPTX), and TypeBox schemas that serve as both TypeScript types and runtime validators from a single source of truth.

**vs. Carbone**: Carbone is template-driven: design a `.docx` in Word, sprinkle `{placeholders}`, inject data. Works when structure is fixed and only data changes. When structure is dynamic (conditional sections, variable-length tables, data-driven layouts) templates become brittle. json-to-office replaces the template file with a composable component tree. No LibreOffice dependency.

**vs. Gamma**: Gamma is a SaaS presentation tool with AI-powered design — great for one-off decks made by hand. But your data never leaves their platform, there's no API for programmatic generation, and output is tied to their format. json-to-office is infrastructure: self-hosted, schema-driven, embeddable in any pipeline, producing native `.pptx`/`.docx` files you fully own.

## Features

### DOCX: 13 components

| Component          | Highlights                                                      |
| ------------------ | --------------------------------------------------------------- |
| paragraph, heading | Markdown-style bold/italic in text, h1–h6                       |
| table              | Auto-width columns, merged cells, styled headers                |
| image              | URL / file / base64, contain / cover / crop, captions, floating |
| list               | 57 numbering formats, 9 nesting levels                          |
| columns            | Multi-column layouts                                            |
| text-box           | Positioned text regions                                         |
| statistic          | KPI cards                                                       |
| highcharts         | Server-side chart rendering                                     |
| header / footer    | Per-section, first-page variant                                 |
| table of contents  | Auto-generated from headings                                    |
| section            | Independent page size, orientation, margins                     |

### PPTX: 7 components

| Component  | Highlights                                                                        |
| ---------- | --------------------------------------------------------------------------------- |
| text       | Bullets, hyperlinks, style presets                                                |
| image      | Rotation, rounded corners, shadows                                                |
| shape      | 15 types: rect, ellipse, arrow, star, cloud, etc.                                 |
| table      | Auto-pagination with header repeat, colspan/rowspan                               |
| chart      | 8 native PowerPoint types: bar, line, pie, area, doughnut, radar, bubble, scatter |
| highcharts | Server-side chart rendering                                                       |
| slide      | Grid-based positioning, backgrounds, templates                                    |

### Cross-format

- **Theme system**: colors, fonts, spacing, component defaults. 3 built-in themes per format (minimal, corporate, vibrant/modern), or define your own.
- **Schema validation**: full TypeBox schemas that serve as TypeScript types _and_ runtime validators. Catch errors before rendering.
- **Plugin architecture**: create versioned custom components with `createComponent()`. Full TypeScript support, chainable API, schema generation.
- **Template / placeholder system** (PPTX): slide templates with named placeholder regions, static + dynamic content, style inheritance.
- **Grid layout** (PPTX): 12-column responsive grid with configurable margins and gutters.

## Full examples

### DOCX

```bash
npm install @json-to-office/json-to-docx
```

```ts
import { generateAndSaveFromJson as docx } from '@json-to-office/json-to-docx';

await docx(
  {
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
              header: { content: 'Metric' },
              cells: [{ content: 'Revenue' }, { content: 'Users' }],
            },
            {
              header: { content: 'Value' },
              cells: [{ content: '$4.2M' }, { content: '12,847' }],
            },
          ],
        },
      },
    ],
  },
  'report.docx'
);
```

### PPTX

```bash
npm install @json-to-office/json-to-pptx
```

```ts
import { generateAndSaveFromJson as pptx } from '@json-to-office/json-to-pptx';

await pptx(
  {
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
              data: [{ name: 'Revenue', values: [1.2, 2.4, 3.1, 4.2] }],
              grid: { column: 0, row: 1, columnSpan: 8, rowSpan: 5 },
            },
          },
        ],
      },
    ],
  },
  'deck.pptx'
);
```

### CLI

```bash
# Start the visual playground with live preview
jto docx dev --input ./my-template.json
jto pptx dev --input ./my-template.json

# Generate files directly
jto docx generate --input ./my-template.json --output ./report.docx
jto pptx generate --input ./my-template.json --output ./deck.pptx
```

### Visual playground

The dev server gives you a Monaco editor with JSON autocomplete and validation, live document preview, built-in templates, and theme switching, all in the browser. **LibreOffice is not required**: the playground renders previews natively. If LibreOffice (headless) is installed, the playground can optionally use it for high-fidelity PDF rendering, the only way to get pixel-accurate output, especially for PPTX where no browser renderer exists. It also integrates **Claude** (Opus/Sonnet/Haiku) as a built-in AI chat assistant: describe a document in plain English and get schema-validated JSON back, rendered live. Both LibreOffice and Claude are playground-only extras; the core rendering libraries have zero dependency on either.

## Who it's for

- **API-driven SaaS teams**: Document definitions live in the database, rendered on demand. No template files to deploy, no LibreOffice sidecar.
- **LLM-powered generation**: An LLM can reliably emit a schema-validated JSON document definition. No hallucinated method names, no wrong constructor signatures — just data constrained by a schema.
- **Decoupled pipelines**: A data team or visual editor produces JSON; a Node.js service renders it. No shared code, language, or deployment.

## Use cases

- **On-demand reports from a dashboard**: User clicks "Export" → your backend fetches data, builds JSON, renders `.docx` or `.pptx`, returns the file. No template files on disk.
- **LLM document generation**: Prompt an LLM with the TypeBox schema → it outputs valid JSON → render it. No hallucinated method calls, no brittle code generation.
- **Scheduled batch exports**: A cron job queries your DB, assembles JSON definitions, renders hundreds of personalized documents (invoices, contracts, reports) without spinning up LibreOffice.
- **Multi-tenant SaaS templates**: Store document definitions per-tenant in your DB. Tenants customize structure and styling through a UI; your backend renders on demand.
- **Internal tooling / back-office**: Non-developers define documents in the visual playground, save the JSON, and ops renders them via CLI or API — no deploys needed.
- **Headless CMS → Office docs**: Content lives in a CMS as structured data. A pipeline transforms it into json-to-office JSON and renders downloadable `.docx`/`.pptx` files.
- **CI/CD artifacts**: Generate changelogs, release notes, or test reports as `.docx` files directly in your pipeline from structured build data.

## Examples

See the `[examples/](examples/)` directory for complete, runnable JSON definitions:

- **[invoice.docx.json](examples/invoice.docx.json)**: Professional invoice with line items, totals, payment terms
- **[annual-review.docx.json](examples/annual-review.docx.json)**: Multi-section annual review with TOC, statistics, tables, lists
- **[pitch-deck.pptx.json](examples/pitch-deck.pptx.json)**: Series A pitch deck with KPI cards, charts, grid layout

## Packages

| Package                                                 | Description                          |
| ------------------------------------------------------- | ------------------------------------ |
| `[@json-to-office/json-to-docx](packages/json-to-docx)` | DOCX generation from JSON            |
| `[@json-to-office/json-to-pptx](packages/json-to-pptx)` | PPTX generation from JSON            |
| `[@json-to-office/jto](packages/jto)`                   | CLI + dev server + visual playground |

Internal packages

| Package                                               | Description                            |
| ----------------------------------------------------- | -------------------------------------- |
| `[@json-to-office/core-docx](packages/core-docx)`     | Core DOCX engine                       |
| `[@json-to-office/core-pptx](packages/core-pptx)`     | Core PPTX engine                       |
| `[@json-to-office/shared](packages/shared)`           | Format-agnostic schemas and validation |
| `[@json-to-office/shared-docx](packages/shared-docx)` | DOCX-specific schemas                  |
| `[@json-to-office/shared-pptx](packages/shared-pptx)` | PPTX-specific schemas                  |

## Development

```bash
git clone https://github.com/Wiseair-srl/json-to-office.git
cd json-to-office
pnpm install
pnpm build
pnpm dev    # Start dev server with hot reload
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full development guide.

## License

[MIT](LICENSE), Wiseair srl
