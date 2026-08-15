# What is json-to-office?

json-to-office lets you describe Microsoft Word (`.docx`) and PowerPoint (`.pptx`) documents as plain JSON and render them into real Office files. The document definition is **data, not code** — serializable, portable, and language-agnostic.

## Documents as data

Libraries like [docx](https://github.com/dolanmiu/docx) and [pptxgenjs](https://github.com/gitbrent/PptxGenJS) are imperative, code-first APIs: you build documents by constructing class instances and chaining methods. That works, but the document definition _is_ the program. You can't store it in a database, send it over an API, generate it from an LLM, or hand it to a non-developer.

json-to-office flips this around. A document is a JSON tree:

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

That JSON can live in a database row, travel over HTTP, come out of an LLM, or be edited in a visual playground with autocomplete and validation. Definition and rendering are fully decoupled: the buffer and file APIs produce byte-identical Office archives for stable renderer versions, themes, and external asset bytes.

## Why not just use X?

Generating an Office document from a backend usually means one of four approaches. The question to start from: **what should a document _be_, in a system?** If it's an output of your platform — emitted thousands of times, on demand, by services and LLMs, branded, regeneratable, auditable — it should behave like data: serializable, validatable, versionable, diffable.

|                   | json-to-office                          | Imperative libs (docx, pptxgenjs, officegen, react-pdf) | Template-driven (Carbone, docxtemplater) | SaaS / AI doc tools (Gamma, Tome) | Plain LLM (prompt → .docx/.pptx) |
| ----------------- | --------------------------------------- | ------------------------------------------------------- | ---------------------------------------- | --------------------------------- | -------------------------------- |
| **Document is**   | Declarative JSON                        | Code                                                    | Binary template + data                   | Hosted artifact                   | Free-form prompt                 |
| **Serializable**  | Yes                                     | No: trapped in code                                     | Partial: data is JSON, structure isn't   | No: locked in platform            | No: prompt ≠ output              |
| **Reproducible**  | Byte-identical output for stable inputs | Library-dependent                                       | Template-dependent                       | No                                | No: stochastic                   |
| **LLM-friendly**  | Schema-constrained output               | Fragile: no schema                                      | Needs pre-made template                  | N/A                               | No structure, no validation      |
| **Validation**    | Full TypeBox schemas                    | None                                                    | None                                     | N/A                               | None                             |
| **Themes**        | Built-in, swappable                     | Manual styling                                          | Baked into template                      | Built-in                          | Whatever the model picks         |
| **Extensibility** | Plugin architecture + semver            | Library APIs                                            | Limited                                  | None                              | None                             |
| **Self-hosted**   | Yes                                     | Yes                                                     | Yes (+ LibreOffice)                      | No                                | No (API)                         |

- **vs. imperative libs.** docx and pptxgenjs are json-to-office's own rendering backends. The difference is the layer above them: a schema-validated JSON contract, themes, a layout pipeline, a plugin architecture, and TypeBox schemas that double as TypeScript types and runtime validators. What your code emits stops being code and starts being a value — storable, sendable, replayable.
- **vs. template-driven.** Templates work when structure is fixed and only data changes. They break the moment structure becomes dynamic: conditional sections, variable-length tables, data-driven layouts. A `.docx` template is an opaque binary — you cannot diff it, lint it, or compose it. JSON you can.
- **vs. SaaS / AI doc tools.** Built for a human assembling one deck in a browser, not a backend emitting thousands of branded documents from structured inputs. No API contract, no self-hosting, no ownership of the pipeline or the artifact.
- **vs. plain LLM output.** An LLM can emit a `.pptx` directly if you ask. But the output is non-deterministic — same prompt, different document, no validation, no replay — and it conflates _content_ with _rendering_. With a JSON layer, the LLM emits a small, schema-constrained value, and predictable code handles rendering. See [LLM integration](/guide/llms).

## Key features

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

DOCX also supports **document diff**: because documents are data, two versions diff like data, and the result opens in Word as native tracked changes (accept/reject, author, timestamp, review mode). See [Writing DOCX](/guide/writing-docx).

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
| slide      | Grid-based positioning, backgrounds, templates                                           |

### Cross-format

- **Theme system** — colors, fonts, spacing, and component defaults. 3 built-in themes per format, or define your own. See [Themes & styling](/guide/themes).
- **Font system** — a curated Office-safe font list plus `fonts.extraEntries` for Google Fonts and custom TTF/OTF. See [Fonts](/guide/fonts).
- **Schema validation** — full TypeBox schemas that serve as TypeScript types _and_ runtime validators, so errors surface before rendering. See [Validation](/guide/validation).
- **Plugin architecture** — versioned custom components with `createComponent()`, full TypeScript support, and schema generation. See [Architecture](/guide/architecture).
- **Template / placeholder system** (PPTX) — slide templates with named placeholder regions, static and dynamic content, style inheritance.
- **Grid layout** (PPTX) — 12-column responsive grid with configurable margins and gutters. See [Slides & grid](/reference/pptx/slides-and-grid).

## Who it's for

- **API-driven SaaS teams** that need to emit branded reports, invoices, or decks from backend services.
- **LLM-powered products** where a model generates the document JSON against a schema and deterministic code renders it.
- **Teams that want decoupled pipelines** — the system that decides _what_ a document contains is separate from the system that renders it.

## Use cases

- On-demand dashboard exports ("Download as PowerPoint")
- LLM document generation with schema-constrained output
- Scheduled batch exports (weekly reports, statements)
- Multi-tenant SaaS templates — one JSON structure, per-tenant themes
- Internal tooling and back-office document generation
- Headless CMS content rendered to Office documents
- CI/CD artifacts — release notes or audit reports as `.docx`

::: info Practical details
MIT licensed, self-hostable, published on npm under the `@json-to-office` scope. Requires Node 20 or later. Source at [Wiseair-srl/json-to-office](https://github.com/Wiseair-srl/json-to-office).
:::

## Next steps

- [Getting started](/guide/getting-started) — install and generate your first documents in minutes.
- [Core concepts](/guide/core-concepts) — the JSON tree model, components, props, and themes.
- [Playground](/guide/playground) — or skip the install and try the hosted [DOCX](https://docx.json-to-office.com) and [PPTX](https://pptx.json-to-office.com) playgrounds now.
