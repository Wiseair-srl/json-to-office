# What is json-to-office?

> **This page:** the idea the library is built around, in one read. The hands-on version is [Getting started](/guide/getting-started); the tree model and props are [Core concepts](/guide/core-concepts).

## The problem

A backend that has to emit a `.docx` or a `.pptx` has four options, and each of them answers a different question than the one you asked.

**Build it in code.** [docx](https://github.com/dolanmiu/docx) and [pptxgenjs](https://github.com/gitbrent/PptxGenJS) give you class instances and method chains, and they work. But the document definition _is_ the program. A customer complains about the report you sent them in March; you can't retrieve what that report said, because it never existed as a thing — only as a code path that ran once over inputs you may or may not still have. Two versions of a layout diff as a diff of TypeScript. Nothing crosses a process boundary, so the service that decides _what_ goes in the document is the same service that knows how a header is styled.

**Fill in a template.** Carbone and docxtemplater work exactly as long as the structure is fixed and only the values move. The first conditional section breaks that, and so does the first table whose row count depends on the data. And the template is an opaque binary: you cannot diff it, lint it, review it in a pull request, or compose two of them. Changing a heading means opening Word.

**Hand it to a SaaS.** Gamma and Tome are built for one human assembling one deck in a browser. There is no API contract to code against, no self-hosting, and the artifact lives on someone else's platform.

**Ask a model for the file.** An LLM will happily emit a `.pptx`. Ask twice and you get two different documents, neither validated, neither replayable — and the prompt that produced them is not the document, so there is nothing to store, diff, or regenerate. It also conflates what the document _says_ with how it _looks_, and the model is worse at the second one.

The four are not variations on one problem. They disagree about something more basic: **what a document is, in a system.** If it is an artifact you render once and email, any of them is fine. If it is an output of your platform — emitted thousands of times, on demand, by services and models, branded, regeneratable, auditable — then it has to behave like everything else you already know how to operate: a value you can store, validate, version, and diff.

## The idea

> **The document is a value. Rendering is a function.**

json-to-office splits the thing that was fused together. The definition is a JSON tree of components and props, and it is inert data. The renderer is a pinned library version that turns that data into Office bytes. Neither knows anything about the other beyond a schema.

|                     | The definition                                               | The renderer                                                    |
| ------------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| **Is**              | a JSON tree of components and props                          | a function of `(JSON, theme, assets)` → `.docx` / `.pptx` bytes |
| **Produced by**     | your service, an LLM, the playground, a row in your database | one pinned version of the library                               |
| **Lives**           | wherever you keep data — DB, S3, git, an HTTP body           | in one Node process, replaceable                                |
| **Lifetime**        | as long as you keep the row                                  | the deployment                                                  |
| **Runs**            | nowhere. It is data                                          | on the server. No Word, no LibreOffice, no sidecar              |
| **Wrong answer to** | "what should this font size be" — that's the theme           | "what should this document say"                                 |

A complete document definition, in full:

```json
{
  "name": "docx",
  "props": { "theme": "minimal" },
  "children": [
    { "name": "heading", "props": { "text": "Q1 Report", "level": 1 } },
    {
      "name": "paragraph",
      "props": { "text": "Revenue grew **32%** quarter-over-quarter." }
    }
  ]
}
```

Store it, send it, generate it, review it. Rendering it is a separate concern that happens later, somewhere else, maybe by someone else.

## What is _not_ in the JSON

There is no escape hatch — no raw OOXML string, no embedded expression language, no callback, no page coordinates you have to compute yourself. Not restricted: **absent**. Every node is a named component with a schema, which is why a definition can be validated before anything renders, autocompleted in an editor, emitted by a model under a JSON Schema, and diffed against last month's version in terms a reviewer understands.

If you find yourself wanting to inject something the components don't express, the missing piece is a **custom component** — a named, versioned, schema-checked node you register with the generator and then use in JSON like any built-in. See [Architecture](/guide/architecture).

## Structure in the tree, style in the theme

That split leaves one real judgement call per document, and it is worth getting right:

> **Structure in the tree. Style in the theme.**

**The tree** carries what the document _means_: this is a heading, this is a table with these columns, this section repeats per region. It changes because the content changed.

**The theme** carries what the document _looks like_: colors, fonts, spacing, per-component defaults. It changes because the brand changed — for every document at once, including the ones you rendered last year.

Pushing style into props is the expensive mistake, and it never looks like one at the time: a `color` here, a font size there, and the document is correct. Then a second tenant arrives, or the brand moves, and the styling is scattered across ten thousand rows of JSON instead of sitting in one theme file. The rule of thumb: if the value would be identical in every document you will ever render, it belongs in the theme. See [Themes & styling](/guide/themes).

## What this buys you

**The same inputs produce the same bytes.** Volatile OOXML metadata and ZIP timestamps are normalized, so a definition, a theme, a pinned library version, and unchanged asset bytes render byte-identically. Regenerating last quarter's report is a real operation, not an approximation of one.

**An LLM emits a value, not a program.** The model's job shrinks to producing a small object against a JSON Schema — no method names to hallucinate, no constructor signatures to get wrong, and a validator that rejects the attempt before anything is rendered. The unreliable part produces content; deterministic code does the rendering. See [Using with LLMs](/guide/llms).

**Documents review like code.** The JSON is what lands in the pull request, so a change to a contract template is a diff a human can read. DOCX goes further: because two versions are just data, `diffDocuments` produces a redline that opens in Word as native tracked changes — accept, reject, author, timestamp. See [Writing Word documents](/guide/writing-docx).

**One structure, many brands.** The same tree rendered under a different theme is a different-looking document. Multi-tenant branding is a column in a table, not a fork of your rendering code.

**Nothing to install next to it.** Rendering is pure Node — no Word, no LibreOffice, no headless browser, no per-tenant template files on disk. The playground can optionally use LibreOffice for pixel-accurate previews; the libraries never do. See [Render server & deployment](/guide/render-server).

## The invariants

These hold regardless of what produced the JSON:

1. **Validation runs before rendering.** A document that fails its schema throws; there is no half-written file and no silently-dropped prop.
2. **An unknown component name is an error.** Not skipped, not passed through — rejected by name.
3. **Expansion is bounded.** Custom components may render other custom components, expanded recursively to at most 20 levels before the generator throws on a suspected circular reference.
4. **What reaches the renderer is base components only.** The processor expands every custom node first, so the renderer's surface is fixed no matter how many plugins you register.
5. **The definition never executes.** It contains no code and no raw markup, so an untrusted definition is untrusted _data_ — the worst case is a validation error.

## Where the pieces sit

```
   your service  |  an LLM  |  the playground  |  a row in your DB
        ↓
   JSON definition          (schema-validated, inert, portable)
        ↓
   processor                (expands custom components, applies theme defaults)
        ↓
   flat tree of base components
        ↓
   renderer                 (docx.js / pptxgenjs)
        ↓
   .docx / .pptx bytes
```

Everything above the processor is yours and can be written in any language, by any system, at any time. Everything below it is a pinned dependency. The seam between them is a JSON Schema, which is the whole point: it is the only thing the two halves have to agree on. [Architecture](/guide/architecture) walks each layer.

## What's in the box

### DOCX

13 components covering the full document surface — see the [DOCX component reference](/reference/docx/components):

| Component          | Highlights                                                      |
| ------------------ | --------------------------------------------------------------- |
| paragraph, heading | Markdown-style bold/italic in text, h1–h6                       |
| table              | Auto-width columns, merged cells, styled headers                |
| image              | URL / file / base64, contain / cover / crop, captions, floating |
| list               | 60 numbering formats, 9 nesting levels                          |
| columns            | Multi-column layouts                                            |
| text-box           | Positioned text regions                                         |
| statistic          | KPI cards                                                       |
| highcharts         | Server-side chart rendering                                     |
| header / footer    | Per-section, with link-to-previous support                      |
| table of contents  | Auto-generated from headings                                    |
| section            | Independent page size, orientation, margins                     |

### PPTX

7 components built around a grid-based layout system — see the [PPTX component reference](/reference/pptx/components):

| Component  | Highlights                                                                               |
| ---------- | ---------------------------------------------------------------------------------------- |
| text       | Bullets, hyperlinks, style presets                                                       |
| image      | Rotation, rounded corners, shadows                                                       |
| shape      | 15 types: rect, ellipse, arrow, star, cloud, and more                                    |
| table      | Auto-pagination with header repeat, colspan/rowspan                                      |
| chart      | 9 native PowerPoint types: area, bar, bar3D, bubble, doughnut, line, pie, radar, scatter |
| highcharts | Server-side chart rendering                                                              |
| slide      | Grid-based positioning, backgrounds, block invocations                                   |

### Both formats

- **Theme system** — colors, fonts, spacing, and component defaults. 5 built-in DOCX themes, 3 PPTX themes, or define your own. See [Themes & styling](/guide/themes).
- **Font system** — a curated Office-safe font list plus `fonts.extraEntries` for Google Fonts and custom TTF/OTF. See [Fonts](/guide/fonts).
- **Schema validation** — TypeBox schemas that are TypeScript types _and_ runtime validators, exportable as JSON Schema. See [Validation](/guide/validation).
- **Plugin architecture** — semver-versioned custom components via `createComponent()`. See [Architecture](/guide/architecture).
- **JSON blocks** — document-local layouts defined once in `props.blocks` and invoked with named slots, in both formats; the editor completes references, slots and whole invocations. See [JSON blocks](/reference/blocks).
- **Grid layout** (PPTX) — 12-column responsive grid with configurable margins and gutters. See [Slides & grid](/reference/pptx/slides-and-grid).

## Where it fits

**A product that emits documents.** "Download as PowerPoint" on a dashboard, invoices from a billing service, weekly statements from a cron job. The backend assembles JSON from data it already has and renders it — no template files to deploy, nothing to install beside Node.

**A product where a model writes the document.** The model fills a schema, your code renders it. Deterministic output, validation before rendering, and a stored definition you can regenerate.

**A pipeline split across teams or languages.** A Python service, a CMS, or a non-developer in the playground produces the JSON; a Node service renders it. They share a schema and nothing else — no library, no deployment, no release calendar.

::: info Practical details
MIT licensed, self-hostable, published on npm under the `@json-to-office` scope. Requires Node 20 or later. Source at [Wiseair-srl/json-to-office](https://github.com/Wiseair-srl/json-to-office).
:::

## Next

- [Getting started](/guide/getting-started) — install and render your first documents in minutes.
- [Core concepts](/guide/core-concepts) — the tree model, components, props, and themes.
- [Playground](/guide/playground) — or skip the install and try the hosted [DOCX](https://docx.json-to-office.com) and [PPTX](https://pptx.json-to-office.com) playgrounds now.
