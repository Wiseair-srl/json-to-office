# @json-to-office/jto

CLI and visual playground for [json-to-office](https://github.com/Wiseair-srl/json-to-office). Describe `.docx` and `.pptx` files as JSON, preview them live, generate them from the command line.

[![npm](https://img.shields.io/npm/v/@json-to-office/jto.svg)](https://www.npmjs.com/package/@json-to-office/jto)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/Wiseair-srl/json-to-office/blob/main/LICENSE)

## Quick start

```bash
npm install -g @json-to-office/jto

# Open the visual playground with live preview
jto docx dev
jto pptx dev
```

![Visual Playground](https://raw.githubusercontent.com/Wiseair-srl/json-to-office/main/docs/playground-screenshot.png)

## CLI commands

### `dev`: visual playground

```bash
jto docx dev --input ./template.json
jto pptx dev --input ./template.json
```

Opens a browser-based IDE at `localhost:3000` with:

| Feature             | Description                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monaco editor       | JSON editing with autocomplete, inline validation, syntax highlighting                                                                               |
| Live preview        | Rendered document updates as you type                                                                                                                |
| Built-in templates  | Start from example documents (dashboards, sales decks, reports)                                                                                      |
| Theme switching     | Toggle between built-in themes or load your own                                                                                                      |
| Schema validation   | Real-time error reporting against TypeBox schemas                                                                                                    |
| AI assistant        | Describe a document in plain English, get schema-validated JSON back (requires Claude API key)                                                       |
| LibreOffice preview | **Optional.** If LibreOffice (headless) is installed, enables high-fidelity PDF rendering for pixel-accurate output. Not required for live previews. |

### `generate`: render files

```bash
jto docx generate --input ./template.json --output ./report.docx
jto pptx generate --input ./template.json --output ./deck.pptx
```

Reads a JSON document definition and writes a `.docx` or `.pptx` file. Works in CI/CD pipelines, cron jobs, and scripts.

## Part of json-to-office

`jto` is the CLI companion to the programmatic libraries:

| Package                                                                                      | Use case                   |
| -------------------------------------------------------------------------------------------- | -------------------------- |
| [`@json-to-office/json-to-docx`](https://www.npmjs.com/package/@json-to-office/json-to-docx) | Generate `.docx` from code |
| [`@json-to-office/json-to-pptx`](https://www.npmjs.com/package/@json-to-office/json-to-pptx) | Generate `.pptx` from code |
| **`@json-to-office/jto`**                                                                    | CLI + visual playground    |

See the [monorepo](https://github.com/Wiseair-srl/json-to-office) for full docs, examples, and the schema reference.

## License

[MIT](https://github.com/Wiseair-srl/json-to-office/blob/main/LICENSE), Wiseair srl
