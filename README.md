# json-to-office

Generate professional `.docx` and `.pptx` files from JSON definitions.

[![CI](https://github.com/Wiseair-srl/json-to-office/actions/workflows/ci.yml/badge.svg)](https://github.com/Wiseair-srl/json-to-office/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Overview

json-to-office lets you define documents and presentations as JSON, then generate Office files programmatically. Use it as a library in your Node.js app or as a CLI with a built-in dev server and visual playground.

## Packages

| Package                                                 | Description                            |
| ------------------------------------------------------- | -------------------------------------- |
| [`@json-to-office/json-to-docx`](packages/json-to-docx) | Public API for DOCX generation         |
| [`@json-to-office/json-to-pptx`](packages/json-to-pptx) | Public API for PPTX generation         |
| [`@json-to-office/jto`](packages/jto)                   | CLI + dev server + visual playground   |
| [`@json-to-office/core-docx`](packages/core-docx)       | Core DOCX generation engine            |
| [`@json-to-office/core-pptx`](packages/core-pptx)       | Core PPTX generation engine            |
| [`@json-to-office/shared`](packages/shared)             | Format-agnostic schemas and validation |
| [`@json-to-office/shared-docx`](packages/shared-docx)   | DOCX-specific schemas and validation   |
| [`@json-to-office/shared-pptx`](packages/shared-pptx)   | PPTX-specific schemas and validation   |

## Quick start

### Generate a DOCX

```bash
npm install @json-to-office/json-to-docx docx
```

```ts
import { generateDocx } from '@json-to-office/json-to-docx';

const buffer = await generateDocx({
  sections: [
    {
      children: [{ type: 'paragraph', text: 'Hello from json-to-office!' }],
    },
  ],
});
```

### Generate a PPTX

```bash
npm install @json-to-office/json-to-pptx pptxgenjs
```

```ts
import { generatePptx } from '@json-to-office/json-to-pptx';

const buffer = await generatePptx({
  slides: [
    {
      elements: [
        {
          type: 'text',
          text: 'Hello from json-to-office!',
          options: { x: 1, y: 1, w: 8, h: 1 },
        },
      ],
    },
  ],
});
```

### CLI & dev server

```bash
npm install -g @json-to-office/jto

# Start the dev server with visual playground
jto docx dev --input ./my-template.json

# Generate a file directly
jto docx generate --input ./my-template.json --output ./output.docx
```

## Development

```bash
# Prerequisites: Node.js >= 20, pnpm

git clone https://github.com/Wiseair-srl/json-to-office.git
cd json-to-office
pnpm install
pnpm build
pnpm dev    # Start dev server with hot reload
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full development guide.

## License

[MIT](LICENSE) - Wiseair srl
