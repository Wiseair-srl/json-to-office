# Using the CLI

json-to-office ships two command-line tools that turn JSON documents into `.docx` and `.pptx` files, validate them, diff them, and scaffold projects around them. This guide walks through the everyday tasks; the [CLI reference](/reference/cli) has every flag, config key, and environment variable.

## `jto` vs `jto-cli`

Both packages expose the same core commands with the same flags — the difference is what else they carry.

|                                                                                        | `@json-to-office/jto` (`jto`)                    | `@json-to-office/jto-cli` (`jto-cli`)             |
| -------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------- |
| Core commands (`generate`, `validate`, `diff`, `schemas`, `discover`, `init`, `fonts`) | Yes                                              | Yes                                               |
| `dev` web playground (React, Monaco, Vite, AI assistant)                               | Yes                                              | No                                                |
| Dependency weight                                                                      | Heavier (playground stack)                       | Lean — no React/Monaco/Vite/AI deps               |
| Best for                                                                               | Local development, exploring, iterating visually | CI pipelines, serverless functions, Docker images |

```bash
# Local development: the full CLI
pnpm add --global @json-to-office/jto

# CI / servers: the lean CLI
pnpm add --global @json-to-office/jto-cli

# Or run either without installing
pnpm dlx @json-to-office/jto docx generate report.json
```

Both require Node >= 20. Every command is scoped by format: `jto docx <command>` for Word documents, `jto pptx <command>` for PowerPoint presentations.

::: tip
If you run `jto-cli docx dev` by mistake, it doesn't fail with "unknown command" — it prints a pointer to install `@json-to-office/jto` and exits with code 1. The rest of this guide uses `jto`; substitute `jto-cli` freely for everything except `dev`.
:::

## Generating documents

The core loop: write a JSON document, run `generate`, open the output.

```bash
jto docx generate report.json                 # writes report.docx in the cwd
jto pptx generate deck.json -o out/deck.pptx  # explicit output path
```

The input is a JSON file following the document schema — see [Writing DOCX documents](/guide/writing-docx) and [Writing PPTX presentations](/guide/writing-pptx).

### Applying a theme

Built-in themes are selected by the document itself — set `props.theme` on the root component (`"minimal"`, `"corporate"`, `"modern"`). For a custom theme file, load and register it with `--theme-path`:

```bash
jto docx generate report.json --theme-path ./brand-theme.json
```

`--theme-path` accepts a `.json` theme file or a JS/TS module that exports a theme object. Themes loaded this way are registered under their `name`, which the document's `props.theme` must reference. The `--theme` flag currently takes effect only in plugin-loaded runs. See [Themes & styling](/guide/themes).

### Custom fonts

Register font files directly, or point the CLI at a directory of `.ttf`/`.otf` files whose filenames encode family and weight (`Inter-Bold.ttf`, `Roboto_500.otf`):

```bash
jto docx generate report.json --font Inter=./fonts/Inter-Regular.ttf
jto docx generate report.json --fonts-dir ./fonts
```

Google Fonts referenced in the document are fetched over HTTP only by the dev-server/LibreOffice preview pipeline — plain `generate` never fetches them, so offline or air-gapped CLI builds need no special flags. To fail hard instead of falling back when a font can't be resolved:

```bash
jto docx generate report.json --strict-fonts              # fail on unresolved fonts
```

If you'd rather rewrite unresolvable fonts to safe, Office-bundled ones instead of keeping the references as-is:

```bash
jto docx generate report.json --font-mode substitute
jto docx generate report.json --font-substitute "Futura=Century Gothic"
```

The substitution target must be one of the safe fonts (`jto docx fonts list` prints them). More in [Fonts](/guide/fonts).

### Plugins and dry runs

```bash
jto docx generate report.json --plugins                # auto-discover plugins
jto docx generate report.json --plugins weather,data   # load specific ones
jto docx generate report.json --plugin-dir ./plugins   # search a directory
jto docx generate report.json --dry-run                # summary, no file written
```

`--dry-run` prints a boxed summary (input, output, format, theme, strict mode, plugins) without writing anything — handy for checking what a CI invocation would do.

::: info Charts
Chart components render through a Highcharts export service. Point the CLI at one with the `HIGHCHARTS_SERVER_URL` environment variable (plus `HIGHCHARTS_API_KEY` if it needs auth). See [Charts](/guide/charts) and the [render server guide](/guide/render-server).
:::

## Validating documents

`validate` checks JSON documents (and theme files) against the schemas before you ever generate. It accepts a single file, a directory, or a glob:

```bash
jto docx validate report.json
jto docx validate ./documents -r          # recurse through **/*.json
jto pptx validate "decks/*.json"          # glob (node_modules/dist/build ignored)
```

By default the type is auto-detected (document vs theme) from the JSON shape; force it with `-t document` or `-t theme`. `--strict` runs strict validation with no cleaning or defaults applied — what you wrote is exactly what gets checked:

```bash
jto docx validate report.json --strict
```

The exit code is `1` if any file fails and `0` otherwise, so it drops straight into CI:

```bash
# package.json script or CI step
jto docx validate ./documents -r --strict -f json > validation-report.json
```

`-f json` emits machine-readable results per file; `-q` prints only errors. More background in [Validation](/guide/validation).

## Diffing DOCX documents into redlines

`diff` compares two JSON documents and produces a `.docx` with **native Word tracked changes** — the same redlines a human reviewer would make, ready for Word's Review pane. It's DOCX-only.

```bash
jto docx diff contract-v1.json contract-v2.json -o redline.docx
jto docx diff old.json new.json --author "legal-bot" --date 2026-08-15T09:00:00Z
jto docx diff old.json new.json --json-out redline.json --format json
jto docx diff old.json new.json --dry-run
```

The summary reports inserted, deleted, and modified tracked changes plus unchanged blocks, and explicitly lists any changes that can't be expressed as tracked changes (so nothing silently disappears). `--json-out` additionally writes the redline as a JSON document definition; `--dry-run` computes everything without writing files.

## Scaffolding a project with `init`

```bash
jto docx init my-reports
jto pptx init my-decks --skip-install
```

`init` creates a new directory containing a `package.json` (with `dev`, `generate`, `validate`, and `schemas` scripts wired to `jto`), a working `example.json`, and a `.gitignore`, then runs `npm install` unless you pass `--skip-install`. Run without a name for an interactive prompt. It refuses to overwrite an existing directory.

## Discovering plugins, documents, and themes

`discover` scans your project for json-to-office plugins, document JSON files, and theme files, and prints them in a table:

```bash
jto docx discover                          # everything in the project
jto docx discover -t plugin                # plugins only
jto docx discover -t theme --scope ./src   # themes under a directory
jto docx discover -j                       # JSON output for tooling
jto docx discover --grouped                # grouped by location
```

::: warning
`--schema` and `--scope` both declare the short flag `-s`. Always spell these two out in full to get the one you mean.
:::

## Generating JSON schemas

`schemas` exports the document and theme JSON Schemas — the same ones the validator uses — so your editor can autocomplete and lint documents as you type, and so LLM agents can be handed a precise contract:

```bash
jto docx schemas                        # writes ./schemas
jto pptx schemas -o ./schemas --split   # one file per component type
jto docx schemas --theme-only
jto docx schemas -f typebox             # TypeBox TypeScript output
jto docx schemas --plugins              # include discovered plugin schemas
```

Point your editor's JSON language server (or a `$schema` property) at the generated files for inline validation. See [JSON schemas](/reference/json-schemas) for the schema layout and [Using json-to-office with LLMs](/guide/llms) for the agent workflow.

## Managing fonts

The `fonts` subcommands cover the whole font lifecycle:

```bash
# What fonts are safe, what's in ./fonts, what does this document use?
jto docx fonts list report.json

# What exactly is in this font file?
jto docx fonts inspect ./fonts/Inter-Bold.ttf

# Download a Google Fonts family as local TTFs
jto docx fonts install Inter
jto docx fonts install "Playfair Display" --weights 400,700 --italics
```

`fonts list` prints the safe (Office-bundled) fonts, the local fonts found in `./fonts` (or `--fonts-dir`), and — given a document — every font it references, tagged `[safe]`, `[google]`, or `[unresolved]`. `fonts inspect` reports family, weight, italic, format, and size, and warns if the file isn't TTF/OTF (WOFF/WOFF2 won't embed in `.docx`). `fonts install` writes files named so that `--fonts-dir` auto-discovery picks them up directly:

```bash
jto docx fonts install Inter -d ./fonts
jto docx generate report.json --fonts-dir ./fonts
```

## Running the dev playground

The full `jto` package includes a web playground: a Monaco JSON editor with schema-aware autocomplete, live preview, discovery browsing, and an optional AI assistant.

```bash
jto docx dev --open    # http://localhost:3003
jto pptx dev --open    # http://localhost:3004
```

DOCX serves on port **3003** and PPTX on **3004** by default; override with `-p`, bind with `-H`, and `--open` launches your browser. On start the CLI prints the local URL, the API URL (`/api/docx/generate` or `/api/pptx/generate`), and the health endpoint.

The AI assistant (backed by your local Claude Code auth) is on by default; disable it with:

```bash
AI_ENABLED=false jto docx dev
```

The playground is covered in depth — including the hosted versions at [docx.json-to-office.com](https://docx.json-to-office.com) and [pptx.json-to-office.com](https://pptx.json-to-office.com) — in [Playground](/guide/playground). The dev server also exposes an HTTP API for generation, validation, diffing, and previews; the endpoint table lives in the [CLI reference](/reference/cli).

## Next steps

- [CLI reference](/reference/cli) — every command, flag, config file, environment variable, and endpoint
- [Getting started](/guide/getting-started) — the end-to-end first document
- [Themes & styling](/guide/themes) and [Fonts](/guide/fonts) — make the output yours
