# CLI reference

Complete reference for the `jto` and `jto-cli` command-line tools: every command, flag, config file, environment variable, exit code, and dev-server endpoint. For a task-oriented walkthrough, see the [CLI guide](/guide/cli).

## Packages

| Package                   | Bin       | Includes                                                                                | Intended for               |
| ------------------------- | --------- | --------------------------------------------------------------------------------------- | -------------------------- |
| `@json-to-office/jto`     | `jto`     | All core commands **plus** the `dev` web playground (React, Monaco, Vite, AI assistant) | Local development          |
| `@json-to-office/jto-cli` | `jto-cli` | Core commands only — no React/Monaco/Vite/AI dependencies                               | CI, serverless, containers |

Both are ESM packages requiring Node >= 20, built on Commander. `jto` depends on `jto-cli` and re-mounts its command set, so flags and behavior are identical for the shared commands. `jto-cli` registers a hidden `dev` placeholder per format that prints a pointer to install `@json-to-office/jto` and exits `1` (instead of Commander's "unknown command").

## Command tree

Every command is mounted under a format parent: `docx` or `pptx`.

```
jto <docx|pptx> generate <input>
jto docx        diff <old> <new>            # DOCX only
jto <docx|pptx> validate <file-or-dir>
jto <docx|pptx> schemas
jto <docx|pptx> discover
jto <docx|pptx> init [name]
jto <docx|pptx> fonts <list|inspect|install>
jto <docx|pptx> dev                         # jto only
```

The format parent selects an adapter that fixes the output extension (`.docx` / `.pptx`), the label, and the default dev-server port (**3003** for docx, **3004** for pptx).

## `generate`

```bash
jto <docx|pptx> generate <input> [options]
```

`<input>` (**required**) is the path to the input JSON file. There is no stdin/stdout mode — input is read from a file and output is written to a file.

| Flag                              | Type                     | Default                                     | Description                                                                                                                                                 |
| --------------------------------- | ------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-o, --output <path>`             | string                   | `<input basename>` + `.docx`/`.pptx` in cwd | Output file path                                                                                                                                            |
| `-t, --template <name>`           | string                   | —                                           | Template name. Reserved — accepted but currently has no effect                                                                                              |
| `--plugins [names-or-paths]`      | string \| boolean        | —                                           | Comma-separated plugin names/paths; bare flag enables auto-discovery                                                                                        |
| `--plugin-dir <dir>`              | string                   | —                                           | Directory to search for plugins                                                                                                                             |
| `--theme <name-or-path>`          | string                   | —                                           | Theme name or path. Currently takes effect only in plugin-loaded runs; in the standard path the theme comes from the document's `props.theme`               |
| `--theme-path <path>`             | string                   | —                                           | Path to a theme file (alternative to `--theme`); `.json` files are parsed, other extensions are dynamically imported (uses the `default` or `theme` export) |
| `--strict`                        | boolean                  | `false`                                     | Enable strict validation                                                                                                                                    |
| `--strict-fonts`                  | boolean                  | `false`                                     | Fail generation on unresolved `fontRegistry` references                                                                                                     |
| `--no-google-fonts`               | boolean                  | —                                           | Accepted but currently has no effect: `generate` performs no Google Fonts fetching (fetching happens only in the dev-server preview pipeline)               |
| `--font-cache-dir <path>`         | string                   | —                                           | Directory to cache fetched Google Fonts TTFs — currently no effect on `generate` output (fetching happens only in the dev-server preview pipeline)          |
| `--font <name=path>`              | string, repeatable       | `[]`                                        | Register a font file: `<family>=<path to .ttf/.otf>`                                                                                                        |
| `--fonts-dir <path>`              | string                   | —                                           | Scan a directory for `.ttf`/`.otf` files and auto-register them by filename                                                                                 |
| `--font-mode <mode>`              | `substitute` \| `custom` | `custom`                                    | `custom` keeps font references as-is; `substitute` rewrites non-safe fonts to safe ones. Any other value errors                                             |
| `--font-substitute <family=safe>` | string, repeatable       | `[]`                                        | Map a non-safe family to a specific safe font; the target must be in the safe-fonts list or the command errors                                              |
| `--dry-run`                       | boolean                  | `false`                                     | Print a summary (input, output, format, theme, strict, plugins) without writing files                                                                       |

Option precedence: CLI flags override values from the [plugin/generation config file](#plugin--generation-config) (`validation.strict`). The config file's `theme` / `themePath` keys are currently not applied by `generate` — theme selection works only through CLI flags or the document's `props.theme`.

Font-directory filename parsing: names like `Inter-BoldItalic.ttf` or `Roboto_500.otf` are parsed into family, weight, and italic; weight names map thin=100 through black/heavy=900; only `.ttf`/`.otf` files are scanned, and multiple variant files coalesce into one registry entry per family.

Theme selection: in the standard (no-plugin) path the theme is chosen by the document's `props.theme`, and `--theme-path` loads a custom theme file and registers it under its `name` — which `props.theme` must reference. `--theme` currently takes effect only when plugins are loaded; there it resolves built-in name → existing `.json` path → parsed as theme JSON, falling back to the `minimal` built-in. A theme that fails to load only warns — generation proceeds. See [Theme schema](/reference/theme-schema).

## `diff` (DOCX only)

```bash
jto docx diff <old> <new> [options]
```

Diffs two JSON documents into a redline `.docx` with native Word tracked changes. Mounted only under `docx`; both inputs are validated before diffing.

| Flag                    | Type               | Default          | Description                                                        |
| ----------------------- | ------------------ | ---------------- | ------------------------------------------------------------------ |
| `-o, --output <path>`   | string             | `redline.docx`   | Output redline path                                                |
| `--author <name>`       | string             | `json-to-office` | Revision author shown in Word                                      |
| `--date <iso>`          | string             | now              | Revision timestamp (ISO 8601); an invalid value errors             |
| `--json-out <path>`     | string             | —                | Also write the redline as a JSON document definition               |
| `-f, --format <format>` | `pretty` \| `json` | `pretty`         | Summary output format; `json` emits `{ output, jsonOut, summary }` |
| `--dry-run`             | boolean            | `false`          | Compute the diff and summary without writing files                 |

The summary reports inserted/deleted/modified tracked changes and unchanged blocks, and lists changes that are not expressible as tracked changes. Exits `0` on success, `1` on failure.

## `validate`

```bash
jto <docx|pptx> validate <file-or-directory> [options]
```

The argument accepts a JSON file, a directory, or a glob pattern (`node_modules`, `dist`, and `build` are ignored).

| Flag                    | Type                            | Default  | Description                                                                                                                                                                       |
| ----------------------- | ------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-t, --type <type>`     | `document` \| `theme` \| `auto` | `auto`   | Auto-detection by shape: `name: 'docx'/'pptx'`, `children[]`, `slides[]`, or `props.metadata.title` ⇒ document; `colors`/`fonts`/`styles`/`pageSetup`/`componentDefaults` ⇒ theme |
| `-s, --schema <path>`   | string                          | —        | Validate against a custom JSON Schema (Ajv with `allErrors` + formats); a missing schema file errors up front                                                                     |
| `--strict`              | boolean                         | `false`  | Use strict validation — no cleaning or defaults applied                                                                                                                           |
| `-q, --quiet`           | boolean                         | `false`  | Only output errors                                                                                                                                                                |
| `-f, --format <format>` | `pretty` \| `json`              | `pretty` | `json` prints a machine-readable result array per file                                                                                                                            |
| `-r, --recursive`       | boolean                         | `false`  | Recurse into directories (`**/*.json`)                                                                                                                                            |

Multi-file runs print a File/Status/Errors table. **Exit code `1` if any file is invalid, else `0`.** Zero matched files warns and exits `0`.

## `schemas`

```bash
jto <docx|pptx> schemas [options]
```

Generates JSON Schemas for documents and themes — for IDE validation, tooling, and [LLM workflows](/guide/llms).

| Flag                         | Type                | Default     | Description                                    |
| ---------------------------- | ------------------- | ----------- | ---------------------------------------------- |
| `-o, --output-dir <path>`    | string              | `./schemas` | Output directory                               |
| `--plugins [names-or-paths]` | string \| boolean   | —           | Include plugin schemas                         |
| `--plugin-dir <dir>`         | string              | —           | Plugin search directory                        |
| `-f, --format <type>`        | `json` \| `typebox` | `json`      | `typebox` emits TypeBox TypeScript files       |
| `--theme-only`               | boolean             | `false`     | Only theme schemas (also skips plugin loading) |
| `--document-only`            | boolean             | `false`     | Only document schemas                          |
| `--split`                    | boolean             | `false`     | Separate schema file per component type        |

Prints a table of generated paths plus any included plugins. See [JSON schemas](/reference/json-schemas) for the output layout.

## `discover`

```bash
jto <docx|pptx> discover [options]
```

Discovers json-to-office plugins, document JSON files, and theme files across the project.

| Flag                     | Type                                       | Default | Description                                   |
| ------------------------ | ------------------------------------------ | ------- | --------------------------------------------- |
| `-j, --json`             | boolean                                    | `false` | JSON output                                   |
| `-s, --schema`           | boolean                                    | `false` | Include full schemas in output (plugins only) |
| `-e, --examples`         | boolean                                    | `false` | Include usage examples (plugins only)         |
| `-t, --type <type>`      | `plugin` \| `document` \| `theme` \| `all` | `all`   | What to discover; an invalid value exits `1`  |
| `-s, --scope <path>`     | string                                     | —       | Limit discovery to a directory                |
| `--max-depth <depth>`    | integer                                    | `10`    | Maximum search depth                          |
| `--include-node-modules` | boolean                                    | `false` | Also search `node_modules`                    |
| `-v, --verbose`          | boolean                                    | `false` | Debug output                                  |
| `--grouped`              | boolean                                    | `false` | Group results by location                     |

::: warning Known quirk: `-s` is declared twice
Both `--schema` and `--scope` register the short flag `-s`, so `-s` is ambiguous. Always use the long forms `--schema` and `--scope`.
:::

## `init`

```bash
jto <docx|pptx> init [name] [options]
```

Scaffolds a new project. Without a name it prompts interactively (initial value `my-json-to-<format>-project`). Fails if the target directory already exists.

| Flag                    | Type    | Default | Description                                                               |
| ----------------------- | ------- | ------- | ------------------------------------------------------------------------- |
| `-t, --template <type>` | string  | `basic` | Project template (currently only `basic` — the scaffold content is fixed) |
| `--skip-install`        | boolean | `false` | Skip running `npm install` after scaffolding                              |

The scaffold contains:

- `package.json` — scripts `dev`, `generate`, `validate`, `schemas` calling `jto <format> …`; dependency `@json-to-office/json-to-docx` (or `-pptx`); devDependencies `@json-to-office/jto` and TypeScript
- `example.json` — a minimal working document (heading + paragraph for docx; one slide with text for pptx)
- `.gitignore`

## `fonts`

Three subcommands. See [Fonts](/guide/fonts) for the concepts behind safe fonts, Google Fonts, and embedding.

### `fonts list`

```bash
jto <docx|pptx> fonts list [document] [options]
```

Prints the safe (Office-bundled) fonts, local fonts found in the fonts directory, and — when a JSON document argument is given — every font the document references, tagged `[safe]`, `[google]` (in the popular Google Fonts list), or `[unresolved]`.

| Flag                 | Type   | Default   | Description                                    |
| -------------------- | ------ | --------- | ---------------------------------------------- |
| `--fonts-dir <path>` | string | `./fonts` | Directory of local `.ttf`/`.otf` files to list |

### `fonts inspect`

```bash
jto <docx|pptx> fonts inspect <file>
```

Prints family, weight, italic, format, and size for a font file. Warns for non-TTF/OTF files: embedding requires TTF or OTF — WOFF/WOFF2 will not embed in `.docx`. No flags.

### `fonts install`

```bash
jto <docx|pptx> fonts install <family> [options]
```

Downloads a Google Fonts family as local TTFs.

| Flag                   | Type             | Default   | Description                                                   |
| ---------------------- | ---------------- | --------- | ------------------------------------------------------------- |
| `-w, --weights <list>` | comma/space list | `400,700` | Weights as 100-step integers 100–900; an invalid token errors |
| `--italics`            | boolean          | `false`   | Also download italic variants                                 |
| `-d, --dir <path>`     | string           | `./fonts` | Output directory                                              |

Files are written atomically (`.tmp` then rename) and named `<Family>-<Weight>[Italic].ttf` (for example `Inter-Regular.ttf`, `Inter-Bold.ttf`), compatible with `--fonts-dir` auto-discovery in `generate`. Any failed file ⇒ exit `1`.

## `dev` (`jto` only)

```bash
jto <docx|pptx> dev [options]
```

Starts the development server with the web playground UI (see [Playground](/guide/playground)).

| Flag                  | Type    | Default                           | Description                                                            |
| --------------------- | ------- | --------------------------------- | ---------------------------------------------------------------------- |
| `-p, --port <port>`   | integer | **3003** (docx) / **3004** (pptx) | Server port. Precedence: CLI flag > format default > config-file value |
| `-H, --host <host>`   | string  | `localhost`                       | Bind host                                                              |
| `-o, --open`          | boolean | `false`                           | Open the browser on start                                              |
| `-c, --config <path>` | string  | —                                 | Config file path                                                       |

On start the CLI prints the local URL, the API URL (`http://<host>:<port>/api/<format>/generate`), and the health URL (`http://<host>:<port>/health`). Shuts down gracefully on SIGINT/SIGTERM.

Client serving in dev mode resolves in order: `JTO_CLIENT_PATH` env override → the bundled client when running from the published package → the source client through a Vite dev server in middleware mode with HMR (HMR port from `development.hmrPort`, default 5173). In production mode the pre-built SPA is served with an SPA fallback.

The AI assistant (`/api/ai/chat`) is mounted unless `AI_ENABLED=false`. It streams via the Vercel AI SDK using the local Claude Code auth (no raw API key), restricted to the `opus` / `sonnet` / `haiku` models (default `opus`), with file tools disallowed and no session persistence.

## Config files

Two independent config systems exist.

### Plugin / generation config

Loaded via cosmiconfig by `generate` and `schemas`. Search order:

- `.json-to-office.config.json` / `.js`
- `json-to-office.config.json` / `.js`
- `.json-to-officerc`, `.json-to-officerc.json` / `.js`
- legacy `json-to-docx` / `json-to-pptx` variants of the above
- `package.json` keys `json-to-office`, `json-to-docx`, `json-to-pptx`

Shape:

```json
{
  "plugins": ["weather"],
  "pluginDirs": ["./plugins"],
  "autoDiscover": false,
  "aliases": {},
  "theme": "minimal",
  "themePath": "./brand-theme.json",
  "discovery": { "maxDepth": 10, "includeNodeModules": false },
  "validation": { "strict": false, "allowUnknownFields": false }
}
```

CLI flags win over config values. Note that the `theme` and `themePath` keys are currently ignored by `generate` — only the corresponding CLI flags take effect. Plugin load order: `--plugins` flag (bare = auto-discover, string = named list) → `autoDiscover` → `plugins` → `--plugin-dir` → `pluginDirs`.

### Dev-server config

Loaded by `dev` (also via `-c/--config`). Files: `json-to-office.config.ts` / `.js` / `.mjs` / `.json`, plus legacy docx/pptx variants. The file is deep-merged over the defaults and TypeBox-validated; an invalid config warns and falls back to defaults. `NODE_ENV=production` forces `mode: 'production'`.

| Key                                    | Default             | Description                                                                   |
| -------------------------------------- | ------------------- | ----------------------------------------------------------------------------- |
| `mode`                                 | `development`       | `development` or `production`                                                 |
| `server.port`                          | `3003`              | Server port (the pptx adapter default 3004 and the `-p` flag take precedence) |
| `server.host`                          | `localhost`         | Bind host                                                                     |
| `server.cors.origin`                   | `*`                 | CORS origin                                                                   |
| `server.cors.credentials`              | `true`              | CORS credentials                                                              |
| `api.basePath`                         | `/api`              | API mount path                                                                |
| `api.upload.maxFileSize`               | `10485760` (10 MB)  | Upload size cap                                                               |
| `api.upload.allowedMimeTypes`          | jpeg, png, gif, svg | Allowed upload types                                                          |
| `playground.enabled`                   | `true`              | Serve the playground UI                                                       |
| `playground.features.livePreview`      | `true`              | Live preview feature flag                                                     |
| `playground.features.templateLibrary`  | `true`              | Template library feature flag                                                 |
| `playground.features.componentBuilder` | `false`             | Component builder feature flag                                                |
| `playground.features.collaboration`    | `false`             | Collaboration feature flag                                                    |
| `development.hmr`                      | `true`              | Vite HMR in source mode                                                       |
| `development.sourceMap`                | `true`              | Source maps                                                                   |
| `development.verbose`                  | `false`             | Verbose logging                                                               |
| `paths.templates`                      | `./templates`       | Templates path                                                                |
| `paths.modules`                        | `./modules`         | Modules path                                                                  |
| `paths.cache`                          | `./.cache`          | Cache path                                                                    |

## Environment variables

| Variable                             | Used by                   | Default                                    | Effect                                                                               |
| ------------------------------------ | ------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `HIGHCHARTS_SERVER_URL`              | generate (both CLIs), dev | —                                          | Highcharts export server URL for [chart rendering](/guide/charts)                    |
| `HIGHCHARTS_API_KEY`                 | generate, dev             | —                                          | API key sent to the Highcharts server                                                |
| `HIGHCHARTS_API_KEY_HEADER`          | generate, dev             | `x-api-key`                                | Header name for the Highcharts API key                                               |
| `JTO_PPTX_RASTERIZER_URL`            | docx generate             | —                                          | Remote rasterizer for `visual` components; unset ⇒ in-process LibreOffice rasterizer |
| `JTO_PPTX_RASTERIZER_API_KEY`        | docx generate             | `HIGHCHARTS_API_KEY`                       | API key sent to the remote rasterizer                                                |
| `JTO_PPTX_RASTERIZER_API_KEY_HEADER` | docx generate             | `HIGHCHARTS_API_KEY_HEADER` or `x-api-key` | Rasterizer API-key header name                                                       |
| `LIBREOFFICE_PATH`                   | rasterizer, previews      | auto-detected                              | Path to the LibreOffice binary                                                       |
| `PDFTOPPM_PATH`                      | rasterizer                | auto-detected                              | Path to the `pdftoppm` binary                                                        |
| `DEBUG`                              | generate                  | —                                          | `true` enables generator debug mode                                                  |
| `JTO_CLIENT_PATH`                    | `jto dev`                 | —                                          | Override the playground client directory                                             |
| `AI_ENABLED`                         | `jto dev`                 | enabled                                    | `false` disables the `/api/ai` routes                                                |
| `API_AUTH_MODE`                      | `jto dev`                 | `required` in production, `auto` otherwise | `required`, `auto`, or explicit `disabled` for an intentionally public/local server  |
| `API_KEY`                            | `jto dev`                 | —                                          | Credential required on `/api/*` when auth mode requires it                           |
| `API_KEY_HEADER`                     | `jto dev`                 | `x-api-key`                                | Header carrying the API key                                                          |
| `CORS_ORIGIN`                        | `jto dev` server          | `*`                                        | Allowed origin(s), comma-separated                                                   |
| `RATE_LIMIT_WINDOW_MS`               | `jto dev` server          | `900000`                                   | Rate-limit window (15 min)                                                           |
| `RATE_LIMIT_MAX`                     | `jto dev` server          | `100` (production) / `1000` (development)  | Requests per window                                                                  |
| `MAX_FILE_SIZE`                      | `jto dev` server          | `10485760`                                 | Upload size cap (bytes)                                                              |
| `LIBREOFFICE_TIMEOUT_MS`             | `jto dev` server          | `30000`                                    | LibreOffice conversion timeout                                                       |
| `LOG_LEVEL`                          | `jto dev` server          | `info`                                     | `error` \| `warn` \| `info` \| `debug`                                               |
| `CACHE_ENABLED`                      | `jto dev` server          | `true`                                     | `false` disables the generation cache                                                |
| `CACHE_MAX_SIZE_MB`                  | `jto dev` server          | `100`                                      | Cache size cap                                                                       |
| `CACHE_TTL_SECONDS`                  | `jto dev` server          | `3600`                                     | Cache TTL                                                                            |
| `CACHE_MAX_ITEMS`                    | `jto dev` server          | `1000`                                     | Cache item cap                                                                       |
| `NODE_ENV`                           | both                      | `development`                              | `production` enables production rate limits and mode                                 |

The dev server loads a `.env` file via dotenv. `PORT` and `UPLOAD_DIR` are parsed into the dev-server env config but not consumed — the dev-server port is set by `-p`, the format default, or `server.port` in the config file. The standalone [render server](/guide/render-server) uses its own `RENDER_AUTH_MODE`, `RENDER_API_KEY`, body/output/concurrency limits, and outbound-source policy in addition to `PORT`, `HIGHCHARTS_UPSTREAM_URL`, and `PROXY_TIMEOUT_MS`.

## Exit codes

| Code | Meaning                                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success (including `--help` / `--version`)                                                                                        |
| `1`  | Any failure: validation errors, generation errors, invalid flag values, failed font downloads, `jto-cli <format> dev` placeholder |

These are the only two codes. Error output special-cases missing files ("File not found") and malformed JSON ("Invalid JSON in input file"), and prints per-path validation errors with suggestions.

## Dev-server HTTP API

Routes are mounted at `/api/<format>` (with legacy aliases `/api/documents` for docx and `/api/presentations` for pptx). Production defaults to `API_AUTH_MODE=required`: all `/api/*` routes require `API_KEY` in the `x-api-key` header (or `API_KEY_HEADER`) and fail closed when no key is configured. Development defaults to `auto`. Set `disabled` only for an intentionally public/local deployment. Rate limits below apply in production mode; development mode is effectively unlimited. See also the [API reference](/reference/api).

| Method   | Route                                                 | Description                                                                                                                                   |
| -------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/api/<format>/generate`                              | Generate a document; returns a base64 envelope with cache HIT/MISS. Client-supplied `fonts.strict` is stripped. 10 req / 15 min in production |
| `POST`   | `/api/<format>/validate`                              | Validate a document JSON                                                                                                                      |
| `POST`   | `/api/docx/diff`                                      | Diff two documents into a redline (DOCX only). 32 MB body cap; 30 req / 15 min in production                                                  |
| `POST`   | `/api/<format>/preview/libreoffice`                   | Convert an uploaded file to PDF via LibreOffice; `503` if LibreOffice is missing                                                              |
| `POST`   | `/api/<format>/preview/libreoffice-from-json`         | JSON → generate → PDF in one step; 16 MB cap                                                                                                  |
| `POST`   | `/api/<format>/standard-components`                   | Resolve plugin components to standard definitions                                                                                             |
| `POST`   | `/api/<format>/rasterize`                             | Rasterize a single-slide pptx to PNG; 32 MB cap, DPI clamped                                                                                  |
| `GET`    | `/api/<format>/cache-stats`                           | Cache statistics                                                                                                                              |
| `GET`    | `/api/<format>/cache-analytics`                       | Cache analytics                                                                                                                               |
| `DELETE` | `/api/<format>/cache`                                 | Clear the cache                                                                                                                               |
| `GET`    | `/api/discovery/all`                                  | Discover plugins, documents, and themes                                                                                                       |
| `GET`    | `/api/discovery/plugins` \| `/documents` \| `/themes` | Discover one kind                                                                                                                             |
| `GET`    | `/api/discovery/plugin/:name`                         | One plugin's metadata                                                                                                                         |
| `POST`   | `/api/discovery/load-plugins`                         | Load plugins into the server                                                                                                                  |
| `GET`    | `/api/discovery/documents/:name/content`              | A discovered document's JSON                                                                                                                  |
| `GET`    | `/api/discovery/themes/:name/content`                 | A discovered theme's JSON                                                                                                                     |
| `GET`    | `/api/discovery/schemas/document` \| `/schemas/theme` | Generated schemas                                                                                                                             |
| `GET`    | `/api/fonts/catalog`                                  | Google Fonts catalog                                                                                                                          |
| `POST`   | `/api/fonts`                                          | Materialize Google Fonts                                                                                                                      |
| `POST`   | `/api/ai/chat`                                        | AI assistant chat stream (unless `AI_ENABLED=false`)                                                                                          |
| `GET`    | `/health`, `/health/ready`, `/health/live`            | Health probes (outside `/api`)                                                                                                                |

## Programmatic use

`@json-to-office/jto-cli` also exports its building blocks for embedding — `DocxFormatAdapter`, `PptxFormatAdapter`, `createAdapter`, `GeneratorFactory`, `SchemaGenerator`, `JsonValidator`, the plugin services (`PluginRegistry`, `PluginLoader`, `PluginDiscoveryService`, `PluginConfigService`), `loadConfig`, `registerCoreCommands` (the composition point the full `jto` uses to add `dev`), and UI helpers. See the [API reference](/reference/api).
