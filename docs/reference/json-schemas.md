# JSON Schemas

Every json-to-office document format is described by a generated JSON Schema (draft-07), derived from the same TypeBox definitions that power runtime validation. The schemas give you editor autocomplete, offline validation, and a machine-readable contract for constraining LLM output.

## Generated files

Running the schema generator creates three local build artifacts in `schemas/`:

| File                       | Describes                                            | Notes                                                                                                                                                                                                         |
| -------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `document.schema.json`     | DOCX document definitions (`name: "docx"` trees)     | Root object requires `name` (const `"docx"`) and `props`; `props` covers `theme`, `componentDefaults`, `language`, `metadata`, `noProofWords`, `trackRevisions`; `children` are the section-level components. |
| `presentation.schema.json` | PPTX presentation definitions (`name: "pptx"` trees) | Top level is an `anyOf` of the 8 component schemas (`pptx`, `slide`, `text`, `image`, `shape`, `table`, `highcharts`, `chart`), each discriminated by a `name` const.                                         |
| `theme.schema.json`        | DOCX theme files (`*.docx.theme.json`)               | **DOCX only** — there is no generated PPTX theme schema file. PPTX themes are much smaller and are validated from the TypeBox schema directly; see [Theme schema](/reference/theme-schema).                   |

Because they follow the standard `name` / `props` / `children` shape with `name` as a discriminator, the schemas drive precise per-component autocomplete: once an editor sees `"name": "table"`, it only offers `table` props.

## How they are generated

The schemas are not hand-written. A generator script converts the TypeBox schemas from `@json-to-office/shared-docx` and `@json-to-office/shared-pptx` into draft-07 JSON Schema:

```bash
# in a repo clone
pnpm generate:schemas   # runs tsx scripts/generate-schemas.ts
```

`pnpm build` runs the same step through turbo, so the files in `schemas/` are regenerated on every full build. The conversion:

- emits `$schema: "https://json-schema.org/draft-07/schema#"`,
- hoists recursive subschemas into `definitions`,
- rewrites TypeBox's internal self-references to `#/definitions/ComponentDefinition`, so the recursive component tree is expressed as a normal JSON Schema `$ref`.

The TypeBox component registry is the source of truth for the generated schemas, runtime validators, and TypeScript types. CI regenerates the schemas and uses them in the example conformance checks.

::: info Local artifacts, not hosted URLs
`schemas/` is ignored by git, and published packages do **not** currently include the generated `.json` files. They ship TypeBox schemas as code, which is what the runtime validators and Monaco integration consume. Generate JSON files with the CLI and commit them in the consuming application when you need a durable contract. A first-party hosted schema registry is a planned product direction, not a stable endpoint today.
:::

## Regenerating locally with the CLI

`jto` (and the lean `jto-cli`) can produce the same schemas anywhere, without a repo clone:

```bash
jto docx schemas                 # document + theme schemas → ./schemas
jto pptx schemas                 # presentation schema → ./schemas
jto docx schemas -o ./my-schemas # custom output directory
```

| Flag                               | Description                                                                                                                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-o, --output-dir <path>`          | Output directory (default `./schemas`).                                                                                                                                                              |
| `--plugins [names-or-paths]`       | Load plugins before generating — comma-separated names/paths, or no value for auto-discovery. The output is an **enriched** schema that includes your custom components alongside the standard ones. |
| `--plugin-dir <dir>`               | Directory to search for plugins.                                                                                                                                                                     |
| `-f, --format <type>`              | `json` (default) for JSON Schema files, or `typebox` for TypeScript TypeBox source files.                                                                                                            |
| `--theme-only` / `--document-only` | Generate only the theme schema, or only the document schema.                                                                                                                                         |
| `--split`                          | Emit a separate schema file per component type instead of one unified file.                                                                                                                          |

```bash
# Enriched schema including your custom components
jto docx schemas --plugins ./my-plugins/kpi-card.js

# TypeBox source instead of JSON
jto pptx schemas --format typebox
```

Plugin builders can do the same programmatically — `generator.generateSchema()` returns the enriched TypeBox schema and `generator.exportSchema(path)` writes it as JSON Schema. See the [Library API](/reference/api#plugin-api).

### Versioning schemas

Schema behavior follows the installed json-to-office version. For reproducible validation, pin the CLI version, generate into a versioned directory in your application, and commit the result:

```bash
pnpm dlx @json-to-office/jto-cli@0.20.0 docx schemas \
  --output-dir ./schemas/json-to-office/0.20.0/docx
pnpm dlx @json-to-office/jto-cli@0.20.0 pptx schemas \
  --output-dir ./schemas/json-to-office/0.20.0/pptx
```

Use an exact package version rather than `latest`; plugin-enriched schemas should also pin every plugin version. Treat a regenerated schema diff as an API-contract change and review it alongside document migrations.

## Using the schemas

### `$schema` in documents

The root `docx` and `pptx` components accept a `$schema` field, so a document can point at its own schema:

```json
{
  "$schema": "./schemas/document.schema.json",
  "name": "docx",
  "props": { "theme": "minimal" },
  "children": []
}
```

Editors that understand the `$schema` convention (VS Code with the JSON language server, JetBrains IDEs) pick this up automatically and validate + autocomplete as you type. If your team hosts the generated file, the value may instead be your own immutable HTTPS URL:

```json
{
  "$schema": "https://schemas.example.com/json-to-office/0.20.0/presentation.schema.json",
  "name": "pptx"
}
```

### Editor mapping by file pattern

Instead of a `$schema` field in every file, map by filename in VS Code's `settings.json`:

```json
{
  "json.schemas": [
    { "fileMatch": ["*.docx.json"], "url": "./schemas/document.schema.json" },
    {
      "fileMatch": ["*.pptx.json"],
      "url": "./schemas/presentation.schema.json"
    },
    { "fileMatch": ["*.docx.theme.json"], "url": "./schemas/theme.schema.json" }
  ]
}
```

The [playground](/guide/playground) does the equivalent for you: its Monaco editor builds the schemas client-side from the same TypeBox sources, so you get identical autocomplete and inline validation with zero setup.

### Constraining LLM output

Because a json-to-office document is pure data, the schemas double as a generation contract for LLMs: pass `document.schema.json` or `presentation.schema.json` as the response schema in structured-output / function-calling APIs, and the model can only emit valid component trees. Validate the result with `validateJsonSchema` (DOCX) or `validate.document` (PPTX) before rendering, and you have a fully typed LLM → document pipeline. See [Using with LLMs](/guide/llms) for concrete patterns.

::: tip Custom components and LLMs
Generate an enriched schema with `--plugins` (or `exportSchema` from a plugin builder) and the LLM can target your custom components too — `kpi-card` becomes as schema-valid as `paragraph`.
:::

## Related

- [Validation](/guide/validation) — how runtime validation relates to these schemas
- [Theme schema](/reference/theme-schema) — the theme file formats in detail
- [CLI reference](/reference/cli) — all `jto` commands and flags
- [Using with LLMs](/guide/llms) — schema-constrained document generation
