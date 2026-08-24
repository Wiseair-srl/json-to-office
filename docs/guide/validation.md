# Validation

json-to-office is validation-first: every component's props are described by a TypeBox schema, and documents are checked against those schemas before anything is rendered. Because the document is data, errors can point at an exact JSON path with an actionable message — instead of a stack trace from deep inside a rendering library.

The two formats take different stances on _when_ that check runs:

- **DOCX**: validation is built into generation. `generateBufferFromJson` refuses to render an invalid document, throwing `JsonValidationError`.
- **PPTX**: generation does **not** validate — validation is an explicit, separate step (`validate.document(...)` or `jto pptx validate`). Render-time problems the schema can't catch — an invalid chart series, an unknown color — surface as coded **pipeline warnings** rather than sinking the whole deck.

::: tip Validate your PPTX before generating
Because PPTX generation skips the schema check, a typo in a prop name is silently ignored rather than reported. Run the validator first in any pipeline where the JSON isn't hand-checked.
:::

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

`generateBufferFromJson` (and the file variants built on it) validates before building, unless you opt out with `options.validation.enabled = false`:

```ts
import {
  generateBufferFromJson,
  JsonValidationError,
  JsonParsingError,
} from '@json-to-office/json-to-docx';

try {
  await generateBufferFromJson(jsonString);
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

- the root is named `pptx` and carries both a `props` object and a `children` array;
- each object carries only the allowed top-level keys (`name`, `id`, `enabled`, `props`, `children`; the root may also carry `$schema`, and plugin components may also carry `version`);
- each component carries a `props` key wherever the registry requires one, and its contents match that component's schema;
- container narrowing holds (`pptx` → `slide` only, `slide` → the six content components);
- leaf components don't carry `children`;
- every value in a slide's `placeholders` record is a valid component of the kind a slide accepts — a named slot is a position for content, so a `slide` or the `pptx` root in one is rejected there just as it would be under `children`.

::: warning `slide` is the only component that may omit `props`
Every slide prop is optional and nothing outside the schema asks for one, so `{ "name": "slide", "children": [...] }` is a whole slide. Everywhere else the key is required and its absence is reported as `required_property` at that node's `/props` pointer:

- `pptx` — the root, where a deck states its title, size and theme; `"props": {}` is enough, since every field inside is optional;
- `text` and `image` — every field is optional individually, but one of `text`/`runs` (and one of `path`/`base64`/`svg`) has to be there for the component to draw anything, so the key stays required rather than letting `{ "name": "text" }` render an empty slide. For `text` the emptiness itself is also caught: `"props": {}` is rejected by the `text`/`runs` content rule. `image` has no equivalent rule yet, so `{ "name": "image", "props": {} }` validates and generation reports an `IMAGE_NO_SOURCE` warning instead;
- `shape`, `table`, `highcharts`, `chart` — their schemas demand a field outright (`type`, `rows`, `options`, `type`+`data`).

Registered plugin components require `props` too, in both the published schema and the walk — what the key holds is the plugin layer's call, that it is there is not. Those, plus the standard components above, are the whole list: the published JSON Schema is generated from the same registry entries the walk reads, so the two ask for the key in the same places.

`props` may be omitted where this says so; it may never be `null`. An explicit `null` is a written value and the schema types the key as an object everywhere, so both the schema and the walk reject it — as a type error at the key, not as a missing one.
:::

Plugin components are validated in two passes: the deep walker requires the `props` key but not its contents (the plugin layer checks those against the resolved component version), and it still walks their `children`. Standard components authored inside a plugin container therefore obey the same prop and tree contract they do anywhere else. `allowUnknownFields` strips unknown props instead of rejecting, mirroring the DOCX options. Noise from TypeBox's generic union catch-alls is filtered out and errors are deduplicated, so what remains is actionable.

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

### Warnings, not errors, at generation

PPTX generation does not run the deep validator — validation is a separate step you invoke yourself. The only hard failures at generation time are a root component that isn't `pptx`, and the image source mutual-exclusivity rule (one of `path` / `base64` / `svg`), both of which throw a plain `Error`.

Everything else the pipeline can recover from — skipped charts, unknown colors, clamped grid positions — is reported as a structured warning rather than an exception. The warning-friendly entry point returns both the file and the warning list:

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

| Code                         | Meaning                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `UNKNOWN_COMPONENT`          | Component name not recognized; node skipped.                                                                                                                       |
| `UNKNOWN_CHART_TYPE`         | `chart.type` isn't a supported chart type.                                                                                                                         |
| `UNKNOWN_SHAPE`              | `shape.type` isn't a supported shape type.                                                                                                                         |
| `CHART_NO_DATA`              | Chart has no data series to render.                                                                                                                                |
| `CHART_INVALID_SERIES`       | A series is missing `labels` or `values`; the chart is skipped.                                                                                                    |
| `CHART_MULTI_SERIES`         | Pie/doughnut chart given multiple series; only the first is rendered.                                                                                              |
| `IMAGE_NO_SOURCE`            | Image has none of `path` / `base64` / `svg`; skipped.                                                                                                              |
| `IMAGE_PROBE_FAILED`         | Intrinsic image dimensions could not be probed (affects auto-sizing).                                                                                              |
| `IMAGE_ZERO_BOX`             | Image sizing box resolved to zero width or height.                                                                                                                 |
| `IMAGE_SVG_RASTER_FAILED`    | An inline `svg` image could not be rasterized, so viewers without SVG support show a broken-image placeholder (PowerPoint 2016+ is unaffected).                    |
| `MISSING_TEMPLATE`           | Slide references a template name that isn't defined.                                                                                                               |
| `UNKNOWN_PLACEHOLDER`        | Slide fills a placeholder name the template doesn't declare.                                                                                                       |
| `PLACEHOLDER_NO_POSITION`    | Placeholder used without a template and without any position; skipped.                                                                                             |
| `THEME_COLOR_FALLBACK`       | Optional theme color slot missing; fell back to `primary`.                                                                                                         |
| `UNKNOWN_COLOR`              | Color string is neither valid hex nor a semantic token — or names a theme slot whose own value resolves to neither, in which case it also falls back to `primary`. |
| `HYPERLINK_SLIDE_UNRESOLVED` | `hyperlink.slide` matches no emitted slide (target disabled, or index outside the authored range); the link is dropped and the component renders unlinked.         |
| `GRID_POSITION_CLAMPED`      | Grid `column` / `row` out of range; clamped into the grid.                                                                                                         |
| `FONT_UNRESOLVED`            | Referenced font family could not be resolved (see [Fonts](/guide/fonts)).                                                                                          |

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
