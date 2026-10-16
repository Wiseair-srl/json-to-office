# Library API

The programmatic API for generating documents from Node.js (or any JS runtime for the parts that don't touch the filesystem). Install `@json-to-office/json-to-docx` for Word documents and `@json-to-office/json-to-pptx` for PowerPoint presentations — each package is a thin facade that re-exports the generation functions, validators, schemas, and types you need.

```bash
pnpm add @json-to-office/json-to-docx @json-to-office/json-to-pptx
```

Both packages require Node >= 22. `@json-to-office/json-to-docx` declares its rendering backend as a peer dependency, `docx@9.8.1`. `@json-to-office/json-to-pptx` brings its own: `pptxgenjs@4.0.1` is a pinned dependency of `@json-to-office/core-pptx`, so nothing else needs installing.

::: info Where functions live
Everything documented here is importable from the two public packages, with a few exceptions that live in `@json-to-office/core-docx` (a published dependency of `json-to-docx`): `generateBufferFromFile`, `generateAndSaveFromFile`, the theme JSON helpers, and the DOCX plugin API. Each is flagged below.
:::

## DOCX generation

```ts
import {
  generateAndSaveFromJson,
  generateBufferFromJson,
} from '@json-to-office/json-to-docx';

await generateAndSaveFromJson(
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

::: info Renderer-native APIs were removed in 0.39
Generation compiles to an internal representation and hands it to a renderer
adapter, so no public API returns or accepts a [docx](https://github.com/dolanmiu/docx)
object any more. Everything that did is gone:

| Removed                                                                    | Use instead                                                                        |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `generateDocument`, `generateDocumentFromJson`, `generateDocumentFromFile` | `generateBufferFromJson` / `generateBufferWithWarnings` / `generateBufferFromFile` |
| `saveDocument(document, …)`, `generateFromConfig`                          | `generateAndSaveFromJson` / `generateAndSaveFromFile`                              |
| `DocumentGenerator.generate(document, options?)`                           | `generateBuffer(document, options?)` or `generateFile(document, path, options?)`   |
| `DocumentGeneratorOptions.enableCache`                                     | — (the component render cache went with the writer layer; the option was a no-op)  |
| `parseTextWithDecorators`, `renderComponent`, `createTypedImageRun`        | — (they were the writer layer)                                                     |

`generateBuffer` returns `{ buffer, warnings, standardDefinition, preservedDefinition?, renderManifest? }`
where `generate` returned `{ document, … }`; every other field is unchanged, so
the migration is usually one method name and reading `buffer` instead of
packing `document` yourself.
:::

### Functions

Except where noted below, these functions accept an optional [`JsonGenerationOptions`](#jsongenerationoptions) as their last parameter. Every entry point returns bytes or writes a file: no renderer object crosses the package boundary, so the backend that produced them stays swappable through the `renderer` option.

| Function                     | Signature                                                     | Description                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generateBufferFromJson`     | `(jsonConfig: string \| object, options?) => Promise<Buffer>` | Main entry point. Accepts a JSON string or an already-parsed object, and packs a `.docx` buffer — the usual choice for HTTP responses. Validates against the document schema first unless `options.validation.enabled === false`; throws `JsonValidationError` on schema errors and `JsonParsingError` (code `JSON_PARSE_ERROR`) on malformed JSON strings. |
| `generateBufferWithWarnings` | `(jsonConfig, options?) => Promise<DocxGenerationResult>`     | Same, returning `{ buffer, warnings }` so a caller can surface what was substituted or dropped instead of leaving it on the console.                                                                                                                                                                                                                        |
| `generateBufferFromConfig`   | `(props, components, options?) => Promise<Buffer>`            | Build from the document's props and children directly, without wrapping them in a root `docx` node.                                                                                                                                                                                                                                                         |
| `generateAndSaveFromJson`    | `(jsonConfig, filename, options?) => Promise<void>`           | Generate and write to disk in one call.                                                                                                                                                                                                                                                                                                                     |
| `generateBufferFromFile`     | `(filePath, options?) => Promise<Buffer>`                     | Load a `.docx.json` file; buffer out.                                                                                                                                                                                                                                                                                                                       |
| `generateAndSaveFromFile`    | `(inputFilePath, outputFilePath, options?) => Promise<void>`  | File in, `.docx` file out.                                                                                                                                                                                                                                                                                                                                  |
| `validateJsonSchema`         | `(jsonConfig: string \| object) => DocumentValidationResult`  | Validate without generating. Returns `{ valid, errors, documentType: 'docx', ... }` — see [Validation](/guide/validation).                                                                                                                                                                                                                                  |

```ts
import {
  generateBufferFromJson,
  validateJsonSchema,
} from '@json-to-office/json-to-docx';

const result = validateJsonSchema(jsonFromClient);
if (!result.valid) {
  console.error(result.errors); // [{ path, message, code?, suggestions? }, ...]
} else {
  const buffer = await generateBufferFromJson(jsonFromClient);
  // send buffer as application/vnd.openxmlformats-officedocument.wordprocessingml.document
}
```

### `JsonGenerationOptions`

| Option                          | Type                                  | Default         | Description                                                                                                                                                                                                                                 |
| ------------------------------- | ------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validation.enabled`            | `boolean`                             | `true`          | Validate the definition before building; schema errors throw `JsonValidationError`.                                                                                                                                                         |
| `validation.allowUnknownFields` | `boolean`                             | `false`         | Ignore unknown props during validation — a migration escape hatch. Do not rely on it to return or render a recursively stripped clone.                                                                                                      |
| `customThemes`                  | `Record<string, ThemeConfig>`         | —               | Custom themes keyed by name; `props.theme` in the document is matched case-insensitively against this map before falling back to built-in themes. See [Themes & styling](/guide/themes).                                                    |
| `services`                      | [`ServicesConfig`](#servicesconfig)   | —               | External service wiring for `highcharts` and `visual` components.                                                                                                                                                                           |
| `fonts`                         | [`FontRuntimeOpts`](#fontruntimeopts) | —               | Font resolution: extra registry entries, Google Fonts fetching, export mode, strictness. See [Fonts](/guide/fonts).                                                                                                                         |
| `renderer`                      | `'docxjs' \| 'office-open'`           | `'docxjs'`      | Backend that turns the compiled document into bytes. `docxjs` is the default and produces the output this pipeline has always produced. `office-open` is experimental, opt-in, and fails before rendering on any feature it cannot express. |
| `baseDir`                       | `string`                              | `process.cwd()` | Directory that relative asset paths (image `path` props) resolve against.                                                                                                                                                                   |
| `warnings`                      | `GenerationWarning[]`                 | —               | Pass an array to collect non-fatal warnings; without it, warnings go to `console.warn`.                                                                                                                                                     |
| `outputPath`                    | `string`                              | —               | Optional output path hint.                                                                                                                                                                                                                  |
| `deterministic`                 | `boolean`                             | `true`          | Normalize volatile OOXML metadata and ZIP timestamps so equivalent input yields byte-identical output. Set `false` to stamp the real wall clock instead. See [Reproducible output](/guide/core-concepts#reproducible-output).               |
| `generatedAt`                   | `string \| Date`                      | epoch           | Timestamp written into package metadata and `{DATE}` / `{DATETIME}` placeholders. Defaults to a stable `2000-01-01T00:00:00Z`. Must be a valid date on or after 1980-01-01 (a ZIP format limit) or generation throws.                       |

### `flattenVisuals`

Replaces every enabled [`visual` component](/reference/docx/components) with a plain `image` (base64 PNG), producing a portable `.docx.json` that renders anywhere with no rasterization service. It walks `children`, section headers/footers, and table cell content.

```ts
import {
  flattenVisuals,
  type FlattenVisualsOptions,
} from '@json-to-office/json-to-docx';

const portable = await flattenVisuals(doc, {
  rasterize, // required: a PptxRasterizer (see ServicesConfig below)
  dpi: 200, // default 200
  concurrency: 4, // default 4
});
```

Visuals with `enabled: false` are left untouched; `id` and `enabled` are preserved on the resulting image nodes.

### `resolveHighchartsOptions`

The effective options of a `highcharts` node: exactly the `infile` the render posts to the export server for that node, in that document, with that theme. The theme is resolved with the same functions generation runs before any chart is drawn, and the request is built with the one the render uses, so the result cannot drift from what was drawn. Pure: nothing is posted.

```ts
import {
  resolveHighchartsOptions,
  resolveHighchartsRequest,
} from '@json-to-office/json-to-docx';

const options = resolveHighchartsOptions({
  options: node.props.options, // as authored
  width: node.props.width, // the placed width scales the type
  height: node.props.height,
  theme, // the ThemeConfig handed to the generator (`theme` or a `customThemes` entry)
  documentProps: document.props, // its themeOverrides and componentDefaults
  page: section.props.page, // the chart's top-level section, if it overrides the page
  fonts, // the generator's `fonts` option, if any
});
```

What reaches the options, in the render's order: the document's `themeOverrides`, the theme's design system (type roles become styles), the font export mode (`substitute` rewrites families), the document's `componentDefaults` over the theme's; then the theme's and document's `componentDefaults.highcharts.options` beneath the node's own options, the theme's chart palette when the node sets no `colors`, and the document's type scaled to the width the chart is placed at — a percentage `width` is of the text width of the section's page. See [Charts](/guide/charts#theme-chart-options).

Pass the theme as you hand it to the generator, not a theme you resolved yourself, and the same `documentProps`, `page` and `fonts` the document renders with: each of them can change the result.

`resolveHighchartsRequest(input)` returns the whole body posted to `/export` — `{ infile, type: 'png', b64: true, scale, resources? }`. It also takes `scale`, `resources` and `fontFaces` (the faces handed to the export server, which only add `@font-face` rules to `resources.css`; the options never depend on them).

### `diffDocuments`

Word-level document diffing that produces a redline document with **native Word tracked changes** (re-exported from `@json-to-office/shared-docx` through the main package).

```ts
import { diffDocuments } from '@json-to-office/json-to-docx';

const { document, summary } = diffDocuments(oldDoc, newDoc, {
  author: 'Legal review', // default "json-to-office"
  date: '2026-08-15T00:00:00Z', // default: deterministic epoch
});
// document → renderable redline; root gains trackRevisions: true
// summary  → { tracked: { modified, inserted, deleted }, untracked, unchangedBlocks, notes }
```

Both inputs must be `docx` definitions. Paragraphs, headings, and list items diff as tracked insertions/deletions; structural changes the redline cannot express (tables, images, charts) are replaced and reported in `summary.untracked`. The result renders with any of the generate functions above.

### Theme JSON helpers

Load, validate, and export [DOCX theme files](/reference/theme-schema). Import from `@json-to-office/core-docx`:

| Function                  | Signature                                  | Description                                                                     |
| ------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| `loadThemeFromJson`       | `(jsonString) => Promise<ThemeConfigJson>` | Parse and validate a theme from a JSON string.                                  |
| `loadThemeFromFile`       | `(filePath) => Promise<ThemeConfigJson>`   | Load from disk. Hardened: `.json` extension only, 10 MB max, no path traversal. |
| `exportThemeToJson`       | `(theme, pretty = true) => string`         | Serialize a theme back to JSON.                                                 |
| `validateThemeJsonString` | `(jsonString) => ValidationResult`         | Validate without parsing into a usable theme.                                   |
| `createMinimalTheme`      | `() => ThemeConfigJson`                    | A minimal valid theme to start from.                                            |

Failures throw typed errors: `ThemeValidationError`, `ThemeParseError`, `ThemeFileError`.

```ts
import { loadThemeFromFile } from '@json-to-office/core-docx';
import { generateAndSaveFromJson } from '@json-to-office/json-to-docx';

const brand = await loadThemeFromFile('./brand.docx.theme.json');
await generateAndSaveFromJson(doc, 'report.docx', {
  customThemes: { [brand.name]: brand },
});
```

## PPTX generation

```ts
import { generateBufferWithWarnings } from '@json-to-office/json-to-pptx';

const { buffer, warnings } = await generateBufferWithWarnings({
  name: 'pptx',
  props: {
    title: 'Demo',
    theme: 'consulting',
    slideWidth: 13.33,
    slideHeight: 7.5,
  },
  children: [
    {
      name: 'slide',
      props: { background: { color: 'background' } },
      children: [
        {
          name: 'text',
          props: {
            text: 'Hello',
            style: 'title',
            grid: { column: 0, row: 0, columnSpan: 12, rowSpan: 2 },
          },
        },
      ],
    },
  ],
});
for (const w of warnings) console.warn(`[${w.code}] ${w.message}`);
```

### Functions

| Function                     | Signature                                                     | Description                                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `generateBufferFromJson`     | `(jsonConfig: string \| object, options?) => Promise<Buffer>` | JSON in, `.pptx` buffer out.                                                                                                                                                   |
| `generateBufferWithWarnings` | `(jsonConfig, options?) => Promise<GenerationResult>`         | The recommended entry point: returns `{ buffer, warnings }` so you can surface pipeline warnings. Also normalizes inline theme objects and runs the font export-mode pre-pass. |
| `generateAndSaveFromJson`    | `(jsonConfig, outputPath, options?) => Promise<void>`         | Generate and write to disk.                                                                                                                                                    |
| `generateFromFile`           | `(filePath, outputPath) => Promise<void>`                     | `.pptx.json` file in, `.pptx` file out.                                                                                                                                        |

::: info Renderer-native APIs were removed in 0.37
`generatePresentation` (which returned a PptxGenJS instance) and
`savePresentation` are gone. Generation now compiles to an internal
representation and hands it to a renderer adapter, so no public API returns or
accepts a backend object. Use `generateBufferFromJson` /
`generateBufferWithWarnings` and write the buffer yourself, or
`generateAndSaveFromJson`.
:::

`GenerationResult` is `{ buffer: Buffer; warnings: PipelineWarning[] }`, where each warning is `{ code, message, component?, slide? }`. The exported `WarningCodes` registry lists the standard codes (`UNKNOWN_COMPONENT`, `CHART_INVALID_SERIES`, `IMAGE_NO_SOURCE`, `GRID_POSITION_CLAMPED`, `FONT_UNRESOLVED`, …). `HYPERLINK_SLIDE_UNRESOLVED` is also emitted but lives outside that registry. See [PPTX warnings](/reference/pptx/warnings).

::: tip PPTX generation validates, like DOCX
Generation runs the schema validator before rendering and throws `PresentationValidationError` on schema errors — set `options.validation.enabled = false` to skip it. Pipeline warnings cover only recoverable problems found later. See [Validation](/guide/validation) and [PPTX warnings](/reference/pptx/warnings).
:::

### `GenerationOptions`

| Option          | Type                                  | Default       | Description                                                                                                                                                                                                                                        |
| --------------- | ------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `customThemes`  | `Record<string, PptxThemeConfig>`     | —             | Custom themes keyed by name, referenced by `props.theme` in the document. A PPTX document can also inline a full theme object directly in `props.theme` — no options needed.                                                                       |
| `services`      | [`ServicesConfig`](#servicesconfig)   | —             | e.g. `{ highcharts: { serverUrl, headers } }` for the `highcharts` component.                                                                                                                                                                      |
| `fonts`         | [`FontRuntimeOpts`](#fontruntimeopts) | —             | Font resolution and export-mode handling, same shape as DOCX.                                                                                                                                                                                      |
| `renderer`      | `'pptxgenjs' \| 'office-open'`        | `'pptxgenjs'` | Backend that turns the compiled presentation into bytes. `pptxgenjs` is the default and produces the output this pipeline has always produced. `office-open` is experimental, opt-in, and fails before rendering on any feature it cannot express. |
| `validation`    | `GenerationValidationOptions`         | —             | `{ enabled, allowUnknownFields }`. Validation runs before rendering and throws `PresentationValidationError`; set `enabled: false` to skip it.                                                                                                     |
| `deterministic` | `boolean`                             | `true`        | Normalize package metadata and ZIP timestamps for byte-identical output, including the XLSX packages embedded in native charts. See [Reproducible output](/guide/core-concepts#reproducible-output).                                               |
| `generatedAt`   | `string \| Date`                      | epoch         | Timestamp written into package metadata. Defaults to a stable `2000-01-01T00:00:00Z`; must be on or after 1980-01-01 or generation throws.                                                                                                         |

## Quality analysis

Design-quality analysis is an explicit core API. It is not re-exported by the
`json-to-*` facade packages, and direct library generation does not apply a
quality gate automatically:

```ts
import { analyzeDocxQuality } from '@json-to-office/core-docx';
import { analyzePptxQuality } from '@json-to-office/core-pptx';

const analysis = analyzePptxQuality(deck, {
  profile: { id: 'executive-presentation', formats: ['pptx'] },
  policy: { gate: 'warning' },
});

if (analysis.blocked) throw new Error('Quality gate failed');
```

Both analyzers are synchronous and accept `{ customThemes?, renderer?, profile?,
policy?, prepared? }`. They return a `QualityAnalysis` containing diagnostics,
severity counts, the gate verdict, suppression/truncation metadata and rule
errors. The cores also export their format facts, profiles, rule packs and
prepared-document helpers; `@json-to-office/quality` exports the shared engine
and contracts. See [Design quality](/guide/design-quality) for rules, profiles,
policy precedence and limits.

## Plugin API

Custom components are semver-versioned units with a TypeBox props schema and an async `render()` that expands into standard components (or other custom components — nesting is re-expanded recursively up to 20 levels). See [Architecture](/guide/architecture) for how the processor pipeline works.

### `createComponent` and `createVersion`

Shared between both formats (each package re-exports them — from `@json-to-office/json-to-pptx` for PPTX, from `@json-to-office/core-docx` for DOCX):

```ts
import { Type } from '@sinclair/typebox';
import { createComponent, createVersion } from '@json-to-office/core-docx';

const kpiCard = createComponent({
  name: 'kpi-card',
  versions: {
    '1.0.0': createVersion({
      propsSchema: Type.Object({
        label: Type.String(),
        value: Type.String(),
      }),
      async render({ props, theme, addWarning }) {
        return [
          {
            name: 'statistic',
            props: { number: props.value, description: props.label },
          },
        ];
      },
    }),
  },
});
```

- `versions` maps **semver strings** to version entries; a document can pin a version, and an omitted version resolves to the latest.
- Each version is `{ propsSchema, render, hasChildren?, description? }`.
- `render(context)` receives `{ props, theme, addWarning, children? }` — validated props, the resolved theme, a warning collector, and processed children for container components — and returns a `Promise` of an array of components.

### `createDocumentGenerator` (DOCX)

Import from `@json-to-office/core-docx`. Returns a chainable, type-accumulating builder:

```ts
import { createDocumentGenerator } from '@json-to-office/core-docx';

const generator = createDocumentGenerator({ theme: myTheme }).addComponent(
  kpiCard
);

const { buffer, warnings } = await generator.generateBuffer({
  name: 'docx',
  props: {},
  children: [{ name: 'kpi-card', props: { label: 'ARR', value: '$1.2M' } }],
});
```

**Options** (`DocumentGeneratorOptions`):

| Option          | Type                          | Default    | Description                                                                                                                                              |
| --------------- | ----------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `theme`         | `ThemeConfig`                 | —          | Default theme when no custom or built-in theme matches.                                                                                                  |
| `customThemes`  | `Record<string, ThemeConfig>` | —          | Custom themes resolved per-document via `props.theme`.                                                                                                   |
| `debug`         | `boolean`                     | `false`    | Debug logging.                                                                                                                                           |
| `services`      | `ServicesConfig`              | —          | Highcharts / pptx-rasterizer wiring.                                                                                                                     |
| `fonts`         | `FontRuntimeOpts`             | —          | Font resolution options.                                                                                                                                 |
| `validation`    | `GenerationValidationOptions` | on         | Default validation behavior for every generate call; per-call options override.                                                                          |
| `deterministic` | `boolean`                     | `true`     | Normalize volatile OOXML values so the same document produces the same bytes.                                                                            |
| `generatedAt`   | `string \| Date`              | epoch      | Timestamp written into document metadata.                                                                                                                |
| `baseDir`       | `string`                      | `cwd()`    | Directory relative image `path` props resolve against; per-call `options.baseDir` overrides it.                                                          |
| `renderer`      | `'docxjs' \| 'office-open'`   | `'docxjs'` | Backend that turns the compiled document into bytes. `office-open` is experimental, opt-in, and fails before rendering on any feature it cannot express. |

**Builder methods:**

| Method                                                                   | Returns                                                  | Description                                                                                                                        |
| ------------------------------------------------------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `addComponent(component)`                                                | new builder                                              | Registers a custom component; TypeScript accumulates the component types so documents are fully typed.                             |
| `generateBuffer(document, options?)`                                     | `Promise<{ buffer, warnings, standardDefinition, ... }>` | Expand plugins and pack a `.docx` buffer. `standardDefinition` is the fully-expanded standard-component tree.                      |
| `generateFile(document, outputPath, options?)`                           | `Promise<{ warnings, standardDefinition, ... }>`         | Same, written to disk.                                                                                                             |
| `expandStandardDefinition(document, options?)`                           | `Promise<{ standardDefinition, warnings }>`              | Expansion only — no fonts, no layout, no rendering, no external services. Use it when you want the JSON tree and not a document.   |
| `prepareQuality(document, options?)`                                     | `Promise<{ prepared, warnings }>`                        | The quality model with plugins expanded as generation expands them; pass `prepared` to `analyzeDocxQuality`. Nothing renders.      |
| `validate(document)`                                                     | `{ valid, errors? }`                                     | Validate against the enriched (standard + custom) schema.                                                                          |
| `getComponentNames()`                                                    | `string[]`                                               | Registered custom component names.                                                                                                 |
| `generateSchema(includeStandardComponents = true)`                       | `TSchema`                                                | The enriched TypeBox schema.                                                                                                       |
| `exportSchema(outputPath, { includeStandardComponents?, prettyPrint? })` | `Promise<void>`                                          | Write the enriched schema as JSON Schema — see [JSON Schemas](/reference/json-schemas).                                            |
| `getStandardComponentsDefinition(document)`                              | `Promise<ReportComponentDefinition>`                     | **Deprecated.** Runs a second expansion pass; read `standardDefinition` off a generate result, or call `expandStandardDefinition`. |

#### Generation results

`generateBuffer` resolves to a `BufferGenerationResult`; `generateFile` to a `FileGenerationResult`, the same fields without `buffer`.

| Field                 | Type                                 | Description                                                                                                                                                         |
| --------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buffer`              | `Buffer`                             | The `.docx` bytes (`generateBuffer` only).                                                                                                                          |
| `warnings`            | `GenerationWarning[] \| null`        | Non-fatal warnings, `null` when there are none.                                                                                                                     |
| `standardDefinition`  | `ReportComponentDefinition`          | The fully expanded, normalized standard-component tree the document was rendered from.                                                                              |
| `preservedDefinition` | `ExtendedReportComponent`            | Present iff `options.preserveCustomComponents` was passed: the same tree with those custom components kept as authored.                                             |
| `renderManifest`      | [`RenderManifest`](#render-manifest) | One entry per embedded image, saying which node produced it. Absent only when it could not be confirmed against the package — `warnings` then says why (see below). |
| `preservedOutputPath` | `string`                             | `generateFile` only, with `preserveCustomComponents`: where the preserved tree was written as a JSON sidecar.                                                       |

#### Render manifest

`standardDefinition` and `preservedDefinition` are two trees; the manifest is what ties the pictures in the package to them. A custom component whose `render` emits an `image` with no `id`, or a chart that becomes a PNG, otherwise leaves no way back from a media file to the node that asked for it. The origin is recorded while the custom components expand and carried to every image the compiler lowers, so nothing has to be matched by position afterwards.

`RenderManifest` is `RenderManifestEntry[]`: the body's images first, in the order of the `<a:blip r:embed>` elements of `word/document.xml`, then each section's header and footer parts in section order.

| Field          | Type                             | Description                                                                                                                                                                              |
| -------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `part`         | `'body' \| 'header' \| 'footer'` | Where the image sits. Header and footer images are not in the body's blip order.                                                                                                         |
| `partPath`     | `string`                         | The part holding the blip: `word/document.xml`, `word/header1.xml`, …                                                                                                                    |
| `mediaPath`    | `string`                         | The media file the blip embeds, e.g. `word/media/image12.png`. Identical images are stored once, so two entries can name the same file: there is one entry per occurrence.               |
| `sha256`       | `string`                         | Lowercase hex SHA-256 of that media file.                                                                                                                                                |
| `standardPath` | `string`                         | Dot path of the producing node in `standardDefinition`, e.g. `children.4.children.2`, `children.0.props.header.0`, `children.1.props.columns.0.cells.2.content`.                         |
| `kind`         | `string`                         | The standard component at `standardPath`: `image`, `highcharts`, `visual`.                                                                                                               |
| `sourcePath`   | `string?`                        | Only for nodes emitted by a custom component kept by `preserveCustomComponents`: that component's dot path in `preservedDefinition`. Every node one preserved component emits shares it. |
| `sourceKind`   | `string?`                        | The preserved component's name (`mapcharts`, `full-page-image`), alongside `sourcePath`.                                                                                                 |

```ts
const { buffer, renderManifest, standardDefinition, preservedDefinition } =
  await generator.generateBuffer(document, {
    preserveCustomComponents: ['mapcharts'],
  });

for (const entry of renderManifest ?? []) {
  // entry.mediaPath  → 'word/media/image3.png'
  // entry.standardPath → 'children.2.children.0' (kind 'image')
  // entry.sourcePath   → 'children.2'            (sourceKind 'mapcharts')
}
```

How it behaves:

- **Per occurrence.** An image in a header appears once per header part the package writes. A section the layout splits — around columns, say — writes its own copy of the header and footer, and each copy has its entry, all with the same `standardPath`.
- **What `standardPath` names.** The node as it stands in `standardDefinition`: a chart is its `highcharts` node, not the `image` it became; a native `visual` gives one entry per picture it draws. An SVG image is embedded as a PNG fallback blip carrying the SVG as an extension; `mediaPath` and `sha256` are the PNG's.
- **Nested preserved components.** `sourcePath` is the outermost preserved component the node came from — the one `preservedDefinition` holds. A custom component that is not preserved has no node in `preservedDefinition`, so its output carries no `sourcePath`.
- **Checked, or absent.** Every entry is confirmed against the package: the blip of that position must embed the bytes of the image the compiler placed there. A package the check cannot account for gets no manifest rather than a guessed one, and `warnings` carries `W_DOCX_RENDER_MANIFEST_UNAVAILABLE` (exported as `RENDER_MANIFEST_UNAVAILABLE`) with the reason.
- **The bytes do not change.** Building the manifest only reads the finished package, and the path that reaches each image rides on the nodes where nothing that serializes sees it: the `.docx` is byte-identical to what the same call produced before.
- **Rendering from `prepared`.** A call that reuses a `prepareQuality` model (`options.prepared`) gets a manifest too, without `sourcePath`, since that path keeps no preserved tree.

The `RenderManifest`, `RenderManifestEntry` and `RenderManifestPart` types are exported from `@json-to-office/core-docx` and `@json-to-office/json-to-docx`.

There is no `generate()`: it returned a docx.js `Document`, and no public API
hands out a backend object any more. The table at the top of this section maps
it and its neighbours onto what replaced them.

### `createPresentationGenerator` (PPTX)

Import from `@json-to-office/json-to-pptx`. Same shape, PPTX flavored:

```ts
import { createPresentationGenerator } from '@json-to-office/json-to-pptx';

const generator = createPresentationGenerator({ theme: 'dark' }).addComponent(
  myCalloutComponent
);

const { buffer, warnings } = await generator.generate(deckJson);
await generator.generateFile(deckJson, './deck.pptx'); // → { warnings }
```

**Options** (`PresentationGeneratorOptions`): `theme?` (`PptxThemeConfig | string`), `customThemes?`, `debug?`, `services?`, `fonts?`.

**Builder methods:** `addComponent(component)`, `generate(document)` → `Promise<{ buffer, warnings }>`, `generateFile(document, outputPath)` → `Promise<{ warnings }>`, `prepareQuality(document, options?)` → `Promise<{ prepared, warnings }>` (plugins expanded for `analyzePptxQuality`, nothing rendered), `getComponentNames()`, `validate(document)` → `{ valid, errors? }`, `generateSchema()` → `TSchema`, `exportSchema(outputPath, { prettyPrint? })`.

## Shared option shapes

### `ServicesConfig`

Wires the two components that need an external renderer: `highcharts` (both formats) and the DOCX `visual` component. See [Render server](/guide/render-server) for hosting options.

```ts
interface ServicesConfig {
  highcharts?: {
    serverUrl?: string; // Highcharts Export Server (default http://localhost:7801)
    headers?:
      | Record<string, string>
      | ((
          body: unknown
        ) => Record<string, string> | Promise<Record<string, string>>);
  };
  pptx?: {
    // In-process rasterizer — takes precedence over serverUrl.
    render?: (request: { presentation: unknown; dpi: number }) => Promise<{
      base64DataUri: string; // data:image/png;base64,...
      width: number;
      height: number;
    }>;
    serverUrl?: string; // HTTP rasterizer (default http://localhost:7802), POST /rasterize
    headers?:
      | Record<string, string>
      | ((
          body: unknown
        ) => Record<string, string> | Promise<Record<string, string>>);
    dpi?: number; // default DPI when a visual doesn't specify one (default 200, clamped 36-600)
  };
}
```

`services.pptx` is needed only by `visual` components that rasterize. A visual with `"renderMode": "native"` is drawn by the docx backend itself — it never reaches this service, stages no fonts for it and moves none of its counters — so a document whose visuals are all native generates with `services` omitted entirely. See [Native mode](/reference/docx/components#visual-native-mode).

### `FontRuntimeOpts`

Runtime font behavior — not serializable (it can carry Buffers and a callback), so it never lives in the document JSON. Full guide: [Fonts](/guide/fonts).

| Option         | Type                                       | Default                 | Description                                                                                                                                                                                                                                                                                                                                |
| -------------- | ------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `extraEntries` | `FontRegistryEntry[]`                      | —                       | Extra font registry entries (Google Fonts, local files, URLs, base64 data) merged over the document's registry.                                                                                                                                                                                                                            |
| `googleFonts`  | `{ enabled?, cacheDir?, fetchTimeoutMs? }` | fetching enabled        | Google Fonts auto-fetch configuration.                                                                                                                                                                                                                                                                                                     |
| `strict`       | `boolean`                                  | `false`                 | Promote `FONT_UNRESOLVED` warnings to thrown errors.                                                                                                                                                                                                                                                                                       |
| `mode`         | `'custom' \| 'substitute' \| 'embed'`      | `'custom'`              | `custom` keeps font references as-authored; `substitute` rewrites every non-safe family to a SAFE_FONTS equivalent so the file renders identically everywhere; `embed` (DOCX on the `docxjs` renderer) keeps the references and writes the resolved TTF/OTF files into the document — see [Embedding fonts](/guide/fonts#embedding-fonts). |
| `substitution` | `Record<string, string>`                   | category-based defaults | Family → safe-font map applied in `substitute` mode.                                                                                                                                                                                                                                                                                       |
| `baseDir`      | `string`                                   | cwd                     | Base directory for `kind: "file"` font sources.                                                                                                                                                                                                                                                                                            |
| `onResolved`   | `(fonts: ResolvedFont[]) => void`          | —                       | Called once per generate with materialized font bytes — used by the playground to stage fonts for LibreOffice PDF preview. Registering a listener embeds nothing; only `mode: 'embed'` writes font bytes into the file.                                                                                                                    |

## Related

- [Getting started](/guide/getting-started) — end-to-end setup
- [CLI reference](/reference/cli) — the same pipeline from the command line
- [Validation](/guide/validation) — validators, error shapes, strict vs lenient
- [JSON Schemas](/reference/json-schemas) — generated schemas for editors and LLMs
- [DOCX components](/reference/docx/components) and [PPTX components](/reference/pptx/components) — every prop of every component
