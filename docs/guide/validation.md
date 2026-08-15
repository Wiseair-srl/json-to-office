# Validation

json-to-office is validation-first: every component's props are described by a TypeBox schema, and documents are checked against those schemas before anything is rendered. Because the document is data, errors can point at an exact JSON path with an actionable message — instead of a stack trace from deep inside a rendering library.

Both formats validate up front by default and fail hard on schema errors:

- **DOCX**: `generateDocumentFromJson` refuses to render an invalid document, throwing `JsonValidationError`.
- **PPTX**: generation runs the same deep validator before rendering, throwing `PresentationValidationError` on schema errors (opt out with `options.validation.enabled = false`). On top of that, render-time problems the schema can't catch — an invalid chart series, an unknown color — surface as coded **pipeline warnings** rather than sinking the whole deck.

## DOCX validation

### Lenient vs. strict

The validation facade exposes two profiles:

```ts
import { validate, validateStrict } from '@json-to-office/json-to-docx';

// Lenient: cleans extraneous data, applies schema defaults, caps at 100 errors
const result = validate.document(doc);
// or from a JSON string / parsed object:
const result2 = validate.jsonDocument(jsonString);

// Strict: no cleaning, no defaults applied
const strict = validateStrict.document(doc);
```

| Profile            | Cleans data | Applies defaults | Use for                                                           |
| ------------------ | ----------- | ---------------- | ----------------------------------------------------------------- |
| `validate.*`       | yes         | yes              | Normal pipelines — validate and get back normalized `data`        |
| `validateStrict.*` | no          | no               | Auditing exactly what was authored, catching reliance on defaults |

Both return a result of the shape:

```ts
{
  valid: boolean;
  errors: { path: string; message: string; code?: string; suggestions?: string[] }[];
  documentType: 'docx';
  data?: /* the (possibly cleaned) document when valid */;
}
```

The facade also covers themes and individual components: `validate.theme`, `validate.jsonTheme`, `validate.component(name, props)`, `validate.componentDefinition(component)`, `validate.components([...])`, plus boolean guards `isDocument` / `isTheme` / `isComponent`.

### The deep validator: all errors, not the first one

A naive check of a discriminated union stops at the first mismatch and reports it against the wrong branch. The DOCX validator avoids that: when the top-level TypeBox check fails, a comprehensive **deep walk** visits every component in the tree, validates each node's props against its own registry schema, and collects _all_ errors with their JSON paths. If the deep pass finds nothing actionable, the document is treated as valid.

This matters most for automated repair loops (human or [LLM](/guide/llms)): one validation round surfaces every problem at once.

The deep validator accepts options for advanced setups:

- `knownCustomNames` — a set of plugin component names to skip (the plugin layer validates those against their own versioned schemas).
- `allowUnknownFields` — strip unknown props instead of rejecting them. Exposed on generation as `options.validation.allowUnknownFields`, useful as a migration escape hatch.

### The image source rule

An `image` accepts exactly one of three sources: `path`, `base64`, or `svg`. Providing more than one is a semantic error that a per-field schema can't express, so a dedicated check runs **unconditionally** — even when everything else passes:

```text
Image component accepts only one source, but found "path", "base64".
Use exactly one of "path", "base64", or "svg".
```

The error carries code `mutually_exclusive` and the path to the offending component.

### Errors at generation time

`generateDocumentFromJson` (and the buffer/file variants built on it) validates before building, unless you opt out with `options.validation.enabled = false`:

```ts
import {
  generateDocumentFromJson,
  JsonValidationError,
  JsonParsingError,
} from '@json-to-office/json-to-docx';

try {
  await generateDocumentFromJson(jsonString);
} catch (err) {
  if (err instanceof JsonParsingError) {
    // Input string was not valid JSON at all (error code JSON_PARSE_ERROR)
  } else if (err instanceof JsonValidationError) {
    // "Document validation failed" — err carries the full error list
    for (const e of err.errors) console.error(e.path, e.message);
  }
}
```

- Invalid JSON syntax in a string input → `JsonParsingError('Invalid JSON syntax', ...)` with code `JSON_PARSE_ERROR`.
- Schema violations → `JsonValidationError('Document validation failed', errors)` carrying the deep validator's full error list.
- A root component that isn't `docx` → a plain `Error` (`'Top-level component must be a docx component'`).

::: warning
`options.validation.enabled = false` skips schema validation but does **not** make bad documents render correctly — it just moves failures downstream. Keep it on outside of tightly controlled pipelines.
:::

## PPTX validation

### The deep walker

PPTX validation is a single deep walk over the tree — the same engine that powers `jto pptx validate`. For every node it checks:

- the root is named `pptx` and has a `children` array;
- each object carries only the allowed top-level keys (`name`, `id`, `enabled`, `props`, `children`; the root may also carry `$schema`);
- each component's `props` match its registry schema (a missing `props` is validated as `{}`);
- container narrowing holds (`pptx` → `slide` only, `slide` → the six content components);
- leaf components don't carry `children`;
- every value in a slide's `placeholders` record is itself a valid component.

Plugin component names can be skipped via `knownCustomNames`, and `allowUnknownFields` strips unknown props instead of rejecting, mirroring the DOCX options. Noise from TypeBox's generic union catch-alls is filtered out and errors are deduplicated, so what remains is actionable.

```ts
import { validate } from '@json-to-office/json-to-pptx';

const result = validate.document(deck);
if (!result.valid) {
  for (const e of result.errors) console.error(e.path, e.message);
}
```

::: info
For PPTX, `validateStrict` is currently an alias of `validate`: the PPTX deep validation never cleans data or applies defaults, so there is no lenient/strict split to choose between.
:::

### Validation and warnings at generation

PPTX generation runs the full deep validator by default, same stance as DOCX: `generatePresentation` and `generateBufferWithWarnings` validate the component tree up front and throw `PresentationValidationError` on schema errors. Opt out with `options.validation.enabled = false`; `options.validation.allowUnknownFields` strips unknown props instead of rejecting them. (The image source mutual-exclusivity rule — one of `path` / `base64` / `svg` — is also enforced at generation time and throws even with validation disabled.)

Beyond validation, the pipeline reports render-time issues that schema validation can't catch — skipped charts, unknown colors, clamped grid positions — as structured warnings. The warning-friendly entry point returns both the file and the warning list:

```ts
import { generateBufferWithWarnings } from '@json-to-office/json-to-pptx';

const { buffer, warnings } = await generateBufferWithWarnings(deckJson);
for (const w of warnings) {
  console.warn(`[${w.code}] ${w.message}`, w.component ?? '', w.slide ?? '');
}
```

Each warning is a `PipelineWarning`:

```ts
{ code: string; message: string; component?: string; slide?: number }
```

### Warning codes

| Code                      | Meaning                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| `UNKNOWN_COMPONENT`       | Component name not recognized; node skipped.                              |
| `UNKNOWN_CHART_TYPE`      | `chart.type` isn't a supported chart type.                                |
| `UNKNOWN_SHAPE`           | `shape.type` isn't a supported shape type.                                |
| `CHART_NO_DATA`           | Chart has no data series to render.                                       |
| `CHART_INVALID_SERIES`    | A series is missing `labels` or `values`; the chart is skipped.           |
| `CHART_MULTI_SERIES`      | Pie/doughnut chart given multiple series; only the first is rendered.     |
| `IMAGE_NO_SOURCE`         | Image has none of `path` / `base64` / `svg`; skipped.                     |
| `IMAGE_PROBE_FAILED`      | Intrinsic image dimensions could not be probed (affects auto-sizing).     |
| `IMAGE_ZERO_BOX`          | Image sizing box resolved to zero width or height.                        |
| `MISSING_TEMPLATE`        | Slide references a template name that isn't defined.                      |
| `UNKNOWN_PLACEHOLDER`     | Slide fills a placeholder name the template doesn't declare.              |
| `PLACEHOLDER_NO_POSITION` | Placeholder used without a template and without any position; skipped.    |
| `THEME_COLOR_FALLBACK`    | Optional theme color slot missing; fell back to `primary`.                |
| `UNKNOWN_COLOR`           | Color string is neither valid hex nor a semantic token.                   |
| `GRID_POSITION_CLAMPED`   | Grid `column` / `row` out of range; clamped into the grid.                |
| `FONT_UNRESOLVED`         | Referenced font family could not be resolved (see [Fonts](/guide/fonts)). |

::: tip Treat warnings as CI failures
`generateBufferWithWarnings` makes it easy to enforce a zero-warning policy: fail the build when `warnings.length > 0`. You get DOCX-style strictness where you want it, without losing PPTX's resilience in interactive use.
:::

## Validating from the CLI

Both CLIs ship a `validate` command that runs the same validators against a file, a directory (`--recursive`), or a glob — with `--strict`, `--type document|theme|auto`, a custom `--schema`, and `--format json` for machine-readable output:

```bash
jto docx validate ./report.docx.json
jto pptx validate ./decks --recursive --strict
jto-cli docx validate ./report.docx.json --format json
```

See the [CLI reference](/reference/cli) for all flags and exit codes.

## Validating in your editor

The repository publishes generated JSON Schemas (`document.schema.json`, `presentation.schema.json`, `theme.schema.json`), so editors like VS Code can validate and autocomplete your documents as you type — point the root `$schema` field at the schema and every prop table in this documentation becomes inline tooltips. See [JSON Schemas](/reference/json-schemas) for setup, and [LLM generation](/guide/llms) for using the same schemas to constrain model output.
