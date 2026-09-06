# Validation

json-to-office validates a document before it renders. A misspelled prop, wrong
type, illegal child or incompatible renderer feature is reported against the
authored JSON path instead of failing deep inside an Office-writing library.

Validation answers **can this document be built as requested?** It does not
answer **is this document well designed?** That second question belongs to
[Design quality](/guide/design-quality), which produces advisory findings and
can apply a separate CI gate.

## What gets checked

The pipeline has distinct stages. Keeping them separate makes the result — throw,
returned error or warning — predictable.

| Stage                      | What it catches                                                                 | Result                                                |
| -------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------- |
| JSON parsing               | Malformed JSON strings                                                          | Parse error; no document exists to inspect            |
| Schema and deep validation | Wrong types, unknown props, missing fields, unknown components, illegal nesting | Path-addressed validation errors                      |
| Semantic validation        | Invalid field combinations a property schema cannot express                     | Path-addressed validation errors                      |
| Renderer compatibility     | Features the selected backend cannot represent                                  | Validation or compiler error before bytes are written |
| Generation diagnostics     | Recoverable problems discovered while resolving or compiling content            | File is produced with structured warnings             |

The JSON Schema used by an editor covers the schema stage. Runtime validators add
the deep walk, semantic rules and renderer profile. Generation then adds anything
that can only be known after themes, blocks, fonts, grids or assets resolve.

::: tip Validate without generating
Use a standalone validator in an editor or repair loop. Use generation when an
invalid document should stop the build. Both paths use the same runtime validators,
but one returns a result and the other throws.
:::

## Choose an entry point

| Need                          | Entry point                                           | Behavior                                                                 |
| ----------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------ |
| Check one object in code      | `validate.document(document)`                         | Returns `{ valid, errors, data? }`                                       |
| Check JSON text in code       | `validate.jsonDocument(json)`                         | Also reports JSON parse failures                                         |
| Audit without defaults        | `validateStrict.document(document)`                   | DOCX disables transformations; PPTX is currently identical to `validate` |
| Generate bytes                | `generateBufferFromJson(...)`                         | Throws when validation blocks generation                                 |
| Validate files or directories | `jto <format> validate ...`                           | Supports globs, recursion, JSON output and quality policy                |
| Validate while typing         | Published JSON Schemas                                | Schema-only editor diagnostics and autocomplete                          |
| Give an agent repair targets  | `jto_validate` in the [MCP server](/guide/mcp-server) | Returns RFC 6901 paths and stable diagnostic codes                       |

### Standalone validation

Both public packages export the validation facade:

```ts
import { validate as validateDocx } from '@json-to-office/json-to-docx';
import { validate as validatePptx } from '@json-to-office/json-to-pptx';

const docxResult = validateDocx.document(report);
const pptxResult = validatePptx.document(deck);

for (const result of [docxResult, pptxResult]) {
  if (!result.valid) {
    for (const error of result.errors) {
      console.error(error.path, error.code, error.message);
    }
  }
}
```

A document result has this common shape:

```ts
{
  valid: boolean;
  errors: Array<{
    path: string;
    message: string;
    code?: string;
    suggestion?: string;
    suggestions?: string[];
  }>;
  documentType?: 'docx' | 'pptx';
  data?: unknown;
}
```

Paths normally use RFC 6901 JSON Pointer syntax, such as
`/children/2/props/font/size`. Parse failures and a few document-level failures
use `root` instead.

## Shared generation options

Both generation APIs accept:

```ts
{
  validation?: {
    enabled?: boolean;            // default true
    allowUnknownFields?: boolean; // default false
  };
}
```

`allowUnknownFields` is a migration escape hatch: unknown props are ignored for
the validation check while required fields and value types are still enforced.
Do not treat it as a sanitization boundary or rely on the returned/generated
object being a recursively stripped clone.

`validation.enabled = false` removes an important safety boundary. It does not
make an invalid document render correctly; it moves the failure into expansion,
compilation or rendering. PPTX still applies its image/text conflict safety net
when validation is disabled. DOCX does not run its semantic collectors after the
whole validator has been disabled.

## DOCX validation

### Default and strict profiles

DOCX exposes two standalone profiles:

```ts
import { validate, validateStrict } from '@json-to-office/json-to-docx';

const normal = validate.document(report);
const strict = validateStrict.document(report);
```

| Profile            | Defaults in returned `data` | Cleaning after a successful schema check | Use for                                 |
| ------------------ | --------------------------- | ---------------------------------------- | --------------------------------------- |
| `validate.*`       | yes                         | yes                                      | Normal validation and a resolved result |
| `validateStrict.*` | no                          | no                                       | Auditing exactly what was authored      |

Cleaning happens only after the input passes the initial TypeBox check. It does
not make an unknown-field document valid. Use the generation option
`allowUnknownFields` when migrating old documents, and do not assume it returns a
sanitized tree.

The facade also covers themes and individual components:

- `validate.theme` and `validate.jsonTheme`
- `validate.component(name, props)`
- `validate.componentDefinition(component)`
- `validate.components([...])`
- boolean guards `isDocument`, `isTheme` and `isComponent`

### Deep validation

A direct TypeBox check of a recursive discriminated union can collapse into a
generic error against the wrong union branch. DOCX therefore follows a failed
top-level check with a deep walk. Every standard component is checked against its
own registry schema, including components nested in sections, columns, tables,
text boxes, headers and footers. The walk collects up to 100 actionable errors in
one pass.

Registered plugin names can be excluded from standard-prop checking with the
advanced `knownCustomNames` option. The plugin layer then validates those props
against the resolved component version while the standard validator continues to
check the surrounding tree.

### Semantic rules

The current DOCX validator also rejects combinations the property schemas cannot
express:

- an `image` with more than one non-empty `path`, `base64` or `svg`;
- a paragraph or heading indent containing both `hanging` and `firstLine`;
- footnotes or endnotes attached to revised text;
- a shape-rendered text box without an explicit size, or with an unsupported
  dashed/dotted/double border;
- features incompatible with the document's selected renderer.

These errors carry the authored path and a stable code such as
`mutually_exclusive`, `required`, `unsupported_value` or
`unsupported_renderer_feature`.

::: warning Image source sharp edge
The validator rejects **multiple** DOCX image sources, but the current schema does
not reject zero sources. An image with none of `path`, `base64` or `svg` reaches
generation and the image renderer throws. Supply exactly one.
:::

### Generation errors

```ts
import {
  generateBufferFromJson,
  JsonParsingError,
  JsonValidationError,
} from '@json-to-office/json-to-docx';

try {
  const buffer = await generateBufferFromJson(jsonOrObject);
} catch (error) {
  if (
    error instanceof JsonParsingError ||
    error instanceof JsonValidationError
  ) {
    for (const issue of error.validationErrors) {
      console.error(issue.path, issue.message);
    }
  }
}
```

- Malformed JSON strings throw `JsonParsingError('Invalid JSON syntax', ...)`;
  their issue carries code `JSON_PARSE_ERROR`.
- Schema and semantic failures throw
  `JsonValidationError('Document validation failed', errors)`.
- A syntactically valid JSON **string** whose root is not `docx` is rejected by
  the early parser as a plain `Error('Parsed JSON must be a docx component')`.
  An already-parsed object with the same defect normally reaches validation and
  throws `JsonValidationError`.
- Renderer-profile diagnostics are deferred during generation so the compiler
  can report the unsupported feature with full context.

## PPTX validation

### Deep validation

PPTX validation starts with the deep walk directly. It checks:

- the root is `pptx`, has a `props` object and has a `children` array;
- root keys are limited to `name`, `id`, `enabled`, `props`, `children`,
  `$schema` and `renderer`;
- nested standard components use only `name`, `id`, `enabled`, `props` and
  `children`; registered plugin components may also use `version`;
- each component's props match its registry schema;
- `pptx` contains slides and slides contain the six supported content components, blocks and groups;
- leaves do not carry `children`;
- block invocations name a definition in `props.blocks` and fill only its declared slots, within their budgets;
- registered plugin props are left to the version-aware plugin validator, while
  their nested standard children are still checked.

Generic union catch-alls are removed and duplicate diagnostics are collapsed.

### When `props` may be omitted

`slide` is the only standard PPTX component that may omit `props`. All of its
fields are optional, so this is valid:

```json
{ "name": "slide", "children": [] }
```

The `pptx` root and every content component require the key, even when the props
schema has no individually required field. Registered plugin components require
it too. An explicit `null` is always rejected as a type error.

Two content rules add more precision:

- `text` requires exactly one of `text` or `runs`;
- `image` rejects multiple sources, but `{ "name": "image", "props": {} }`
  currently validates and produces an `IMAGE_NO_SOURCE` generation warning.

### Strict mode

For PPTX, `validateStrict` is currently an alias of `validate`: the deep validator
does not clean data or apply defaults. `--strict` therefore changes DOCX file
validation but not PPTX file validation.

### Generation errors

```ts
import {
  generateBufferFromJson,
  PresentationValidationError,
} from '@json-to-office/json-to-pptx';

try {
  const buffer = await generateBufferFromJson(deck);
} catch (error) {
  if (error instanceof PresentationValidationError) {
    for (const issue of error.errors) {
      console.error(issue.path, issue.message);
    }
  }
}
```

With validation enabled, schema errors and image/text semantic conflicts throw
`PresentationValidationError`. Renderer-profile errors are deliberately deferred
to the compiler, which owns the more complete capability report.

With validation disabled, the image/text conflict check still runs. A conflicting
image or text component then throws a plain `Error('Document validation failed: …')`
instead of `PresentationValidationError`.

Recoverable compiler and renderer problems do not throw. Use
`generateBufferWithWarnings` and the [PPTX warning reference](/reference/pptx/warnings)
to inspect them.

## Validate from the CLI

Both `jto` and the lean `jto-cli` package expose the same core command:

```bash
jto docx validate ./report.docx.json
jto pptx validate ./decks --recursive
jto-cli docx validate "./reports/*.json" --format json
```

The command accepts a file, directory or glob. Useful flags include:

- `--recursive`
- `--format pretty|json`
- `--type document|theme|auto`
- `--strict` (DOCX transformation behavior only)
- `--schema <path>` for an alternate JSON Schema
- `--quality-profile`, `--quality-policy` and `--quality-gate`

Schema and semantic errors make the command exit `1`. Design-quality findings
remain advisory unless their policy gate blocks. See [Design quality](/guide/design-quality)
and the complete [CLI reference](/reference/cli#validate).

## Validate in an editor

The repository publishes:

- `document.schema.json` for DOCX;
- `presentation.schema.json` for PPTX;
- `theme.schema.json` for DOCX themes only.

Point a root `$schema` field or editor file mapping at the appropriate schema for
autocomplete, hover descriptions and live schema diagnostics. Editor validation
does not run runtime semantic rules, renderer compatibility checks, generation
warnings or design-quality analysis; run the library or CLI validator before
generation.

See [JSON Schemas](/reference/json-schemas) for setup and [LLM generation](/guide/llms)
for using the same schemas as structured-output contracts.
