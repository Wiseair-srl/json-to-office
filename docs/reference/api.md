# Library API

The programmatic API for generating documents from Node.js (or any JS runtime for the parts that don't touch the filesystem). Install `@json-to-office/json-to-docx` for Word documents and `@json-to-office/json-to-pptx` for PowerPoint presentations — each package is a thin facade that re-exports the generation functions, validators, schemas, and types you need.

```bash
pnpm add @json-to-office/json-to-docx @json-to-office/json-to-pptx
```

Both packages require Node >= 20, and both declare their rendering backend as a peer dependency: `docx@9.5.1` for `@json-to-office/json-to-docx`, `pptxgenjs@^3.12.0` for `@json-to-office/json-to-pptx`.

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

### Functions

Except where noted below, these functions accept an optional [`JsonGenerationOptions`](#jsongenerationoptions) as their last parameter. `Document` is the [docx](https://github.com/dolanmiu/docx) library's document object.

| Function                   | Signature                                                       | Description                                                                                                                                                                                                                                           |
| -------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generateDocument`         | `(document, options?) => Promise<Document>`                     | Main entry point for an already-parsed definition object. Throws if the root component is not `docx`. If the object carries a `$schema` field it is routed through `generateDocumentFromJson` (and therefore validated).                              |
| `generateDocumentFromJson` | `(jsonConfig: string \| object, options?) => Promise<Document>` | Accepts a JSON string or object. Validates against the document schema first unless `options.validation.enabled === false`; throws `JsonValidationError` on schema errors and `JsonParsingError` (code `JSON_PARSE_ERROR`) on malformed JSON strings. |
| `generateBufferFromJson`   | `(jsonConfig, options?) => Promise<Buffer>`                     | Same as above, packed to a `.docx` buffer — the usual choice for HTTP responses.                                                                                                                                                                      |
| `generateAndSaveFromJson`  | `(jsonConfig, filename, options?) => Promise<void>`             | Generate and write to disk in one call.                                                                                                                                                                                                               |
| `generateDocumentFromFile` | `(filePath, options?) => Promise<Document>`                     | Load a `.docx.json` file and generate.                                                                                                                                                                                                                |
| `generateBufferFromFile`   | `(filePath, options?) => Promise<Buffer>`                       | File in, buffer out. Import from `@json-to-office/core-docx`.                                                                                                                                                                                         |
| `generateAndSaveFromFile`  | `(inputFilePath, outputFilePath, options?) => Promise<void>`    | File in, `.docx` file out. Import from `@json-to-office/core-docx`.                                                                                                                                                                                   |
| `saveDocument`             | `(document: Document, filename) => Promise<void>`               | Write a generated `Document` to disk, deduplicating floating-image IDs.                                                                                                                                                                               |
| `validateJsonSchema`       | `(jsonConfig: string \| object) => DocumentValidationResult`    | Validate without generating. Returns `{ valid, errors, documentType: 'docx', ... }` — see [Validation](/guide/validation).                                                                                                                            |

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

| Option                          | Type                                  | Default | Description                                                                                                                                                                              |
| ------------------------------- | ------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validation.enabled`            | `boolean`                             | `true`  | Validate the definition before building; schema errors throw `JsonValidationError`.                                                                                                      |
| `validation.allowUnknownFields` | `boolean`                             | `false` | Strip unknown props instead of rejecting them — an escape hatch when migrating documents across versions.                                                                                |
| `customThemes`                  | `Record<string, ThemeConfig>`         | —       | Custom themes keyed by name; `props.theme` in the document is matched case-insensitively against this map before falling back to built-in themes. See [Themes & styling](/guide/themes). |
| `services`                      | [`ServicesConfig`](#servicesconfig)   | —       | External service wiring for `highcharts` and `visual` components.                                                                                                                        |
| `fonts`                         | [`FontRuntimeOpts`](#fontruntimeopts) | —       | Font resolution: extra registry entries, Google Fonts fetching, export mode, strictness. See [Fonts](/guide/fonts).                                                                      |
| `warnings`                      | `GenerationWarning[]`                 | —       | Pass an array to collect non-fatal warnings; without it, warnings go to `console.warn`.                                                                                                  |
| `outputPath`                    | `string`                              | —       | Optional output path hint.                                                                                                                                                               |

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
    theme: 'default',
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

| Function                     | Signature                                                     | Description                                                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generatePresentation`       | `(document, options?, warnings?) => Promise<PptxGenJS>`       | Low-level entry: returns the pptxgenjs instance. Does not run schema validation — it throws a plain `Error` if the root is not `pptx`, or if an image declares multiple sources. Pass a `PipelineWarning[]` to collect warnings. |
| `generateBufferFromJson`     | `(jsonConfig: string \| object, options?) => Promise<Buffer>` | JSON in, `.pptx` buffer out.                                                                                                                                                                                                     |
| `generateBufferWithWarnings` | `(jsonConfig, options?) => Promise<GenerationResult>`         | The recommended entry point: returns `{ buffer, warnings }` so you can surface pipeline warnings. Also normalizes inline theme objects and runs the font export-mode pre-pass.                                                   |
| `generateAndSaveFromJson`    | `(jsonConfig, outputPath, options?) => Promise<void>`         | Generate and write to disk.                                                                                                                                                                                                      |
| `generateFromFile`           | `(filePath, outputPath) => Promise<void>`                     | `.pptx.json` file in, `.pptx` file out.                                                                                                                                                                                          |
| `savePresentation`           | `(pptx: PptxGenJS, outputPath) => Promise<void>`              | Write a `generatePresentation` result to disk.                                                                                                                                                                                   |

`GenerationResult` is `{ buffer: Buffer; warnings: PipelineWarning[] }`, where each warning is `{ code, message, component?, slide? }`. The `WarningCodes` enum lists every code (`UNKNOWN_COMPONENT`, `CHART_INVALID_SERIES`, `IMAGE_NO_SOURCE`, `GRID_POSITION_CLAMPED`, `FONT_UNRESOLVED`, …) and is exported from the package.

::: warning PPTX generation does not validate
Unlike DOCX, PPTX generation does **not** run the schema validator. Structural mistakes surface as pipeline warnings or are silently skipped, so run `validate.document(...)` from the same package (or `jto pptx validate`) yourself before generating. See [Validation](/guide/validation).
:::

### `GenerationOptions`

| Option         | Type                                  | Default | Description                                                                                                                                                                  |
| -------------- | ------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `customThemes` | `Record<string, PptxThemeConfig>`     | —       | Custom themes keyed by name, referenced by `props.theme` in the document. A PPTX document can also inline a full theme object directly in `props.theme` — no options needed. |
| `services`     | [`ServicesConfig`](#servicesconfig)   | —       | e.g. `{ highcharts: { serverUrl, headers } }` for the `highcharts` component.                                                                                                |
| `fonts`        | [`FontRuntimeOpts`](#fontruntimeopts) | —       | Font resolution and export-mode handling, same shape as DOCX.                                                                                                                |

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

| Option         | Type                          | Description                                                                                     |
| -------------- | ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `theme`        | `ThemeConfig`                 | Default theme when no custom or built-in theme matches.                                         |
| `customThemes` | `Record<string, ThemeConfig>` | Custom themes resolved per-document via `props.theme`.                                          |
| `enableCache`  | `boolean`                     | Component-level render caching.                                                                 |
| `debug`        | `boolean`                     | Debug logging.                                                                                  |
| `services`     | `ServicesConfig`              | Highcharts / pptx-rasterizer wiring.                                                            |
| `fonts`        | `FontRuntimeOpts`             | Font resolution options.                                                                        |
| `validation`   | `GenerationValidationOptions` | Default validation behavior for every generate call (on by default); per-call options override. |

**Builder methods:**

| Method                                                                   | Returns                                                                     | Description                                                                                                          |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `addComponent(component)`                                                | new builder                                                                 | Registers a custom component; TypeScript accumulates the component types so documents are fully typed.               |
| `generate(document, options?)`                                           | `Promise<{ document, warnings, standardDefinition, preservedDefinition? }>` | Expand plugins, generate the docx.js `Document`. `standardDefinition` is the fully-expanded standard-component tree. |
| `generateBuffer(document, options?)`                                     | `Promise<{ buffer, warnings, standardDefinition, ... }>`                    | Same, packed to a buffer.                                                                                            |
| `generateFile(document, outputPath, options?)`                           | `Promise<{ warnings, standardDefinition, ... }>`                            | Same, written to disk.                                                                                               |
| `validate(document)`                                                     | `{ valid, errors? }`                                                        | Validate against the enriched (standard + custom) schema.                                                            |
| `getComponentNames()`                                                    | `string[]`                                                                  | Registered custom component names.                                                                                   |
| `generateSchema(includeStandardComponents = true)`                       | `TSchema`                                                                   | The enriched TypeBox schema.                                                                                         |
| `exportSchema(outputPath, { includeStandardComponents?, prettyPrint? })` | `Promise<void>`                                                             | Write the enriched schema as JSON Schema — see [JSON Schemas](/reference/json-schemas).                              |

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

**Builder methods:** `addComponent(component)`, `generate(document)` → `Promise<{ buffer, warnings }>`, `generateFile(document, outputPath)` → `Promise<{ warnings }>`, `getComponentNames()`, `validate(document)` → `{ valid, errors? }`, `generateSchema()` → `TSchema`, `exportSchema(outputPath, { prettyPrint? })`.

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

### `FontRuntimeOpts`

Runtime font behavior — not serializable (it can carry Buffers and a callback), so it never lives in the document JSON. Full guide: [Fonts](/guide/fonts).

| Option         | Type                                       | Default                 | Description                                                                                                                                                              |
| -------------- | ------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `extraEntries` | `FontRegistryEntry[]`                      | —                       | Extra font registry entries (Google Fonts, local files, URLs, base64 data) merged over the document's registry.                                                          |
| `googleFonts`  | `{ enabled?, cacheDir?, fetchTimeoutMs? }` | fetching enabled        | Google Fonts auto-fetch configuration.                                                                                                                                   |
| `strict`       | `boolean`                                  | `false`                 | Promote `FONT_UNRESOLVED` warnings to thrown errors.                                                                                                                     |
| `mode`         | `'custom' \| 'substitute'`                 | `'custom'`              | `custom` keeps font references as-authored; `substitute` rewrites every non-safe family to a SAFE_FONTS equivalent so the file renders identically everywhere.           |
| `substitution` | `Record<string, string>`                   | category-based defaults | Family → safe-font map applied in `substitute` mode.                                                                                                                     |
| `baseDir`      | `string`                                   | cwd                     | Base directory for `kind: "file"` font sources.                                                                                                                          |
| `onResolved`   | `(fonts: ResolvedFont[]) => void`          | —                       | Called once per generate with materialized font bytes — used by the playground to stage fonts for LibreOffice PDF preview. Office output itself never embeds font bytes. |

## Related

- [Getting started](/guide/getting-started) — end-to-end setup
- [CLI reference](/reference/cli) — the same pipeline from the command line
- [Validation](/guide/validation) — validators, error shapes, strict vs lenient
- [JSON Schemas](/reference/json-schemas) — generated schemas for editors and LLMs
- [DOCX components](/reference/docx/components) and [PPTX components](/reference/pptx/components) — every prop of every component
