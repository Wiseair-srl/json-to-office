# @json-to-office/jto-cli

Lightweight CLI for [json-to-office](https://github.com/Wiseair-srl/json-to-office) — generate `.docx` and `.pptx` from JSON, without the web playground.

Same commands as [`@json-to-office/jto`](https://www.npmjs.com/package/@json-to-office/jto) minus `dev`. No React/Monaco/Vite/AI-SDK dependencies — install this in CI, serverless functions, or any scripted pipeline where the playground UI is dead weight.

```bash
npm install -g @json-to-office/jto-cli

jto-cli docx generate doc.json
jto-cli pptx generate slides.json
jto-cli docx validate ./docs
jto-cli pptx schemas
jto-cli docx discover
jto-cli docx fonts install Inter
```

Want the visual playground (`dev` command, Monaco editor, live preview, AI assistant)? Install [`@json-to-office/jto`](https://www.npmjs.com/package/@json-to-office/jto) instead — it includes everything here plus the playground.

## Programmatic API

```ts
import {
  DocxFormatAdapter,
  PptxFormatAdapter,
  JsonValidator,
  SchemaGenerator,
  PluginRegistry,
} from '@json-to-office/jto-cli';
```

See the monorepo [README](https://github.com/Wiseair-srl/json-to-office) for the full CLI reference and command documentation.

## License

MIT
