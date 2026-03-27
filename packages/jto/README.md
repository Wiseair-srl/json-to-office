# @json-to-office/jto

CLI and visual playground for [json-to-office](https://github.com/Wiseair-srl/json-to-office). Edit document definitions in a Monaco editor with autocomplete and validation, preview rendered output live, and generate `.docx` / `.pptx` files from the command line.

[![npm](https://img.shields.io/npm/v/@json-to-office/jto.svg)](https://www.npmjs.com/package/@json-to-office/jto)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/Wiseair-srl/json-to-office/blob/main/LICENSE)

## Install

```bash
npm install -g @json-to-office/jto
```

## Usage

```bash
# Start the dev server with visual playground
jto docx dev --input ./template.json
jto pptx dev --input ./template.json

# Generate files directly
jto docx generate --input ./template.json --output ./report.docx
jto pptx generate --input ./template.json --output ./deck.pptx
```

## Visual playground

The dev server opens a browser-based IDE with:

- **Monaco editor** — Full JSON editing with autocomplete, inline validation, and syntax highlighting
- **Live preview** — See rendered document output update as you type
- **Built-in templates** — Start from example documents (dashboards, sales decks, reports)
- **Theme switching** — Toggle between built-in themes or load your own
- **Schema validation** — Real-time error reporting against TypeBox schemas

## License

[MIT](https://github.com/Wiseair-srl/json-to-office/blob/main/LICENSE) — Wiseair srl
