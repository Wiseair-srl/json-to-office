# Getting started

This page takes you from zero to a generated `.docx` and `.pptx` in a few minutes — first with the library, then with the CLI, then in the visual playground. Node 20 or later is required.

## Install

```bash
pnpm add @json-to-office/json-to-docx @json-to-office/json-to-pptx
```

Install only the package for the format you need — they are independent.

## Your first DOCX

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
    ],
  },
  'report.docx'
);
```

Open `report.docx` in Word: a themed heading and a paragraph with real bold text (`**32%**` is markdown-style emphasis, parsed by the paragraph component). The `theme: 'minimal'` prop applies one of the built-in themes — swap it for `corporate` or `modern` and regenerate to restyle the whole document without touching content. See [Themes & styling](/guide/themes).

## Your first PPTX

```ts
import { generateAndSaveFromJson as pptx } from '@json-to-office/json-to-pptx';

await pptx(
  {
    name: 'pptx',
    props: { theme: 'dark', grid: { columns: 12, rows: 6 } },
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
              type: 'bar',
              data: [
                {
                  name: 'Revenue',
                  labels: ['Q1', 'Q2', 'Q3', 'Q4'],
                  values: [1.2, 2.4, 3.1, 4.2],
                },
              ],
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

Two things to notice:

- Elements are positioned on a **grid** (here 12 columns by 6 rows) instead of absolute coordinates — the `grid` prop on each component says where it goes. See [Slides & grid](/reference/pptx/slides-and-grid).
- The `chart` component produces a **native, editable PowerPoint chart**, not an image. Nine chart types are available. See [PPTX charts](/reference/pptx/charts).

## Generating from the command line

If your document JSON lives in a file (exported from a database, emitted by an LLM, checked into a repo), you don't need to write any code. Install the CLI globally:

```bash
pnpm add --global @json-to-office/jto
```

Then generate directly:

```bash
jto docx generate ./my-template.json -o ./report.docx
jto pptx generate ./my-template.json -o ./deck.pptx
```

::: tip Two CLIs
`@json-to-office/jto` is the full toolkit: CLI plus a local dev server and visual playground. For CI and scripted pipelines that don't need the playground, install the lean `@json-to-office/jto-cli` instead (`jto-cli docx generate doc.json`) — same `generate` / `validate` / `schemas` / `discover` / `init` / `fonts` commands, about 16 dependencies instead of about 70. See the [CLI guide](/guide/cli) and [CLI reference](/reference/cli).
:::

## Try the playground

The fastest way to explore what's possible is the visual playground — a Monaco editor with JSON autocomplete and validation, live preview, built-in templates, and theme switching.

**Hosted, no install:**

- DOCX: [https://docx.json-to-office.com](https://docx.json-to-office.com)
- PPTX: [https://pptx.json-to-office.com](https://pptx.json-to-office.com)

**Locally**, with the `jto` CLI you installed above:

```bash
jto docx dev   # playground at http://localhost:3003
jto pptx dev   # playground at http://localhost:3004
```

![The visual playground](../playground.gif)

The playground validates your JSON against the full schema as you type, so it doubles as an interactive reference for every component and prop. See the [Playground guide](/guide/playground) for the AI assistant, high-fidelity PDF preview, and more.

## Where to go next

- [Core concepts](/guide/core-concepts) — the component tree model shared by both formats.
- [Writing DOCX](/guide/writing-docx) and [Writing PPTX](/guide/writing-pptx) — format-specific guides.
- [DOCX document reference](/reference/docx/document) and [PPTX presentation reference](/reference/pptx/presentation) — every prop, exhaustively.
- [Examples](/examples/) — complete, runnable document definitions.
- [LLM integration](/guide/llms) — schema-constrained document generation with language models.
