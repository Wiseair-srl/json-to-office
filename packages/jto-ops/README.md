# @json-to-office/jto-ops

Host-side operations layer for [json-to-office](https://github.com/Wiseair-srl/json-to-office): the format adapters that validate and generate documents, the LibreOffice rasterizer behind the docx `visual` component, and the per-platform LibreOffice font stagers.

Extracted from [`@json-to-office/jto-cli`](https://www.npmjs.com/package/@json-to-office/jto-cli) so a host without a terminal — the MCP server, a serverless function, a job runner — can do the work without installing ink, react, commander or chalk. The CLI re-exports everything here, so nothing changes for its consumers.

```ts
import {
  createAdapter,
  createLibreOfficePptxRasterizer,
  getFontStager,
} from '@json-to-office/jto-ops';

const adapter = createAdapter('docx');
const result = await adapter.generate(document, { output: 'out.docx' });
```

## Diagnostics

This package writes to no stream of its own — a host may own stdout as a protocol channel. Warnings and traces go to a sink you scope around the call:

```ts
import {
  runWithDiagnosticSink,
  stderrDiagnosticSink,
} from '@json-to-office/jto-ops';

await runWithDiagnosticSink(stderrDiagnosticSink, () =>
  adapter.generate(document, options)
);
```

With no sink installed the messages are dropped. The CLI installs an Ink-backed sink per task; `stderrDiagnosticSink` is the plain-text fallback for hosts with no UI.

## License

MIT
